// Stripe billing: Checkout for new subscriptions, the Customer Portal for
// changing plan, card, receipts and cancelling, and webhooks to keep each
// user's plan in sync. Card details never touch this server.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetch } from 'undici';
import { apiDispatcher } from './fetcher.js';
import { PLANS, syncPlan } from './plans.js';
import { now } from './db.js';

export class BillingError extends Error {}

/** Encodes nested objects the way Stripe's form API expects: a[b][0][c]=x. */
export function stripeForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') stripeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

/** Verifies the Stripe-Signature header (HMAC-SHA256 over "timestamp.payload"). */
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300, nowSec = Date.now() / 1000) {
  if (!header || !secret) return false;
  let t = 0;
  const sigs = [];
  for (const part of String(header).split(',')) {
    const [k, v] = part.split('=');
    if (k.trim() === 't') t = Number(v);
    else if (k.trim() === 'v1' && v) sigs.push(v.trim());
  }
  if (!t || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
  return sigs.some((s) => {
    const b = Buffer.from(s);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}

export function createBilling({ db, cfg, mailer, log = console }) {
  const base = (cfg.stripeEndpoint || 'https://api.stripe.com').replace(/\/$/, '');
  const enabled = !!(cfg.stripeSecretKey && Object.values(cfg.stripePrices).some((p) => p.monthly || p.yearly));

  async function stripe(method, path, params) {
    const res = await fetch(`${base}/v1${path}`, {
      method,
      dispatcher: apiDispatcher(),
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${cfg.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
      body: params ? stripeForm(params).toString() : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BillingError(`Stripe: ${body.error?.message || `HTTP ${res.status}`}`);
    return body;
  }

  /** price id -> { plan, interval } */
  function priceInfo(priceId) {
    for (const [plan, ids] of Object.entries(cfg.stripePrices))
      for (const [interval, id] of Object.entries(ids)) if (id && id === priceId) return { plan, interval };
    return null;
  }
  const priceAvailable = (plan, interval) => !!cfg.stripePrices[plan]?.[interval];

  async function checkout(user, plan, interval) {
    if (!enabled) throw new BillingError('Payments are not available yet.');
    if (!PLANS[plan] || !priceAvailable(plan, interval)) throw new BillingError('That plan is not available.');
    if (!user.email_verified_at) throw new BillingError('Verify your e-mail address before upgrading.');
    if (user.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(user.sub_status))
      throw new BillingError('You already have a subscription. Change it under "Manage subscription".');
    const session = await stripe('POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: cfg.stripePrices[plan][interval], quantity: 1 }],
      ...(user.stripe_customer_id ? { customer: user.stripe_customer_id } : { customer_email: user.email }),
      client_reference_id: String(user.id),
      metadata: { user_id: String(user.id) },
      subscription_data: { metadata: { user_id: String(user.id) } },
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
      success_url: `${cfg.baseUrl}/dashboard/billing?msg=billing-success`,
      cancel_url: `${cfg.baseUrl}/dashboard/billing?msg=billing-cancelled`,
    });
    return session.url;
  }

  async function portal(user) {
    if (!enabled || !user.stripe_customer_id) throw new BillingError('There is no subscription to manage.');
    const s = await stripe('POST', '/billing_portal/sessions', { customer: user.stripe_customer_id, return_url: `${cfg.baseUrl}/dashboard/billing` });
    return s.url;
  }

  /** Cancels immediately (used when an account is deleted). */
  async function cancelNow(user) {
    if (!enabled || !user.stripe_subscription_id || user.sub_status === 'canceled') return;
    await stripe('DELETE', `/subscriptions/${encodeURIComponent(user.stripe_subscription_id)}`);
  }

  function userFor(obj) {
    const id = Number(obj.metadata?.user_id || obj.client_reference_id || 0);
    return (id && db.one('SELECT * FROM users WHERE id = ?', id)) || (obj.customer && db.one('SELECT * FROM users WHERE stripe_customer_id = ?', obj.customer)) || null;
  }

  async function applySubscription(sub) {
    const user = userFor(sub);
    if (!user) return log.warn?.(`[billing] no user for subscription ${sub.id}`);
    const item = sub.items?.data?.[0];
    const info = priceInfo(item?.price?.id);
    const periodEnd = sub.current_period_end ?? item?.current_period_end;
    // Ignore events about an older subscription than the one we know.
    if (user.stripe_subscription_id && user.stripe_subscription_id !== sub.id && sub.status === 'canceled') return;
    const before = user.plan;
    db.run(
      `UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?), stripe_subscription_id = ?, sub_plan = ?, sub_interval = ?,
         sub_status = ?, sub_period_end = ?, sub_cancel_at_period_end = ? WHERE id = ?`,
      sub.customer, sub.id, info?.plan ?? null, info?.interval ?? null, sub.status,
      periodEnd ? new Date(periodEnd * 1000).toISOString() : null, sub.cancel_at_period_end ? 1 : 0, user.id,
    );
    const after = syncPlan(db, user.id);
    if (before !== after && user.email_verified_at)
      await mailer.send({
        to: user.email,
        subject: `${cfg.siteName}: you are now on the ${PLANS[after].name} plan`,
        text: `Hi ${user.display_name},\n\nYour plan has changed from ${PLANS[before]?.name ?? before} to ${PLANS[after].name}.` +
          (after === 'free' ? `\n\nYour registered artworks stay protected and your certificates stay valid. Monitoring and searches are limited to the Free plan.` : '') +
          `\n\n${cfg.baseUrl}/dashboard/billing\n\n- ${cfg.siteName}`,
      });
  }

  async function handleEvent(event) {
    const seen = db.run('INSERT INTO stripe_events (id, type, received_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING', event.id, event.type, now());
    if (!seen.changes) return 'duplicate';
    const obj = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed': {
        const user = userFor(obj);
        if (user && obj.customer) db.run('UPDATE users SET stripe_customer_id = ? WHERE id = ?', obj.customer, user.id);
        if (obj.subscription) await applySubscription({ ...(await stripe('GET', `/subscriptions/${encodeURIComponent(obj.subscription)}`)), metadata: { user_id: String(user?.id ?? '') } });
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(obj);
        break;
      case 'invoice.payment_failed': {
        const user = userFor(obj);
        if (user?.email_verified_at)
          await mailer.send({
            to: user.email,
            subject: `${cfg.siteName}: your payment failed`,
            text: `Hi ${user.display_name},\n\nWe could not charge your card for your ${cfg.siteName} subscription. ` +
              `Update your payment details here to keep your plan:\n${cfg.baseUrl}/dashboard/billing\n\n- ${cfg.siteName}`,
          });
        break;
      }
      default:
        return 'ignored';
    }
    return 'ok';
  }

  /** Express handler; must receive the raw body. */
  async function webhook(req, res) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!verifyStripeSignature(raw, req.get('stripe-signature'), cfg.stripeWebhookSecret)) return res.status(400).json({ error: 'bad signature' });
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: 'bad json' });
    }
    try {
      res.json({ received: true, result: await handleEvent(event) });
    } catch (e) {
      // Let Stripe retry: forget that we saw it.
      db.run('DELETE FROM stripe_events WHERE id = ?', event.id);
      log.error?.('[billing] webhook failed:', e.message);
      res.status(500).json({ error: 'processing failed' });
    }
  }

  return { enabled, priceAvailable, checkout, portal, cancelNow, webhook, handleEvent };
}
