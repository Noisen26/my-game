import { html, fmtDay } from '../html.js';
import { csrfField, pageHead, errorBlock } from './layout.js';
import { PLANS, fmtPrice } from '../plans.js';

const yes = html`<span class="yes" aria-label="Included">✓</span>`;
const no = html`<span class="no" aria-label="Not included">–</span>`;

function features(p) {
  return [
    [`${p.artworks} registered artworks`, true],
    ['Watermarked portfolio, signed certificates, blockchain timestamps', true],
    ['Protection from known repeat sellers', true],
    [p.webSearchDays === 30 ? 'Web search once a month' : 'Web search every week', true],
    ['New Etsy and eBay listings every 3 days', p.marketplaces],
    [p.hot ? `Close watch (daily searches) for ${p.hot} trending works` : 'Close watch for trending works', p.hot > 0],
    [`${p.watches} monitored shop pages`, true],
    ['Ready-to-send DMCA and EU DSA notices', true],
  ];
}

function planCard({ p, cfg, user, billing, csrf, interval, current }) {
  const price = p.price[interval];
  const perMonth = interval === 'yearly' && price ? html`<span class="muted small">${fmtPrice(Math.round(price / 12), cfg.currency)} / month, billed yearly</span>` : '';
  let action;
  if (p.key === 'free') action = user ? '' : html`<a class="btn btn-ghost btn-block" href="/signup">Start free</a>`;
  else if (current) action = html`<span class="badge badge-ok">Your plan</span>`;
  else if (!user) action = html`<a class="btn btn-block" href="/signup">Start free, upgrade any time</a>`;
  else if (!billing.enabled || !billing.priceAvailable(p.key, interval)) action = html`<button class="btn btn-block" disabled>Coming soon</button>`;
  else if (user.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(user.sub_status))
    action = html`<form method="post" action="/dashboard/billing/portal">${csrfField(csrf)}<button class="btn btn-block">Switch to ${p.name}</button></form>`;
  else
    action = html`<form method="post" action="/dashboard/billing/checkout">${csrfField(csrf)}
      <input type="hidden" name="plan" value="${p.key}"><input type="hidden" name="interval" value="${interval}">
      <button class="btn btn-block">Upgrade to ${p.name}</button></form>`;
  return html`<div class="plan ${p.key === 'artist' ? 'plan-featured' : ''} ${current ? 'plan-current' : ''}">
    ${p.key === 'artist' ? html`<span class="plan-flag">Most popular</span>` : ''}
    <h3>${p.name}</h3>
    <p class="plan-price"><strong>${fmtPrice(price, cfg.currency)}</strong>${price ? html`<span> / ${interval === 'yearly' ? 'year' : 'month'}</span>` : ''}</p>
    ${perMonth}
    <ul class="plan-features">${features(p).map(([t, ok]) => html`<li class="${ok ? '' : 'off'}">${ok ? yes : no} ${t}</li>`)}</ul>
    ${action}
  </div>`;
}

export function plansGrid({ cfg, user, billing, csrf, interval = 'monthly' }) {
  const toggle = (i, label) => html`<a href="?interval=${i}" class="${interval === i ? 'active' : ''}">${label}</a>`;
  return html`
<nav class="filters interval-toggle">${toggle('monthly', 'Monthly')}${toggle('yearly', 'Yearly: 2 months free')}</nav>
<div class="plans">${Object.values(PLANS).map((p) => planCard({ p, cfg, user, billing, csrf, interval, current: user && user.plan === p.key }))}</div>`;
}

export function pricingPage(ctx) {
  return html`
${pageHead('Pricing', 'Protection for every artist. Pay for the searches that find copies for you.')}
${plansGrid(ctx)}
<div class="prose pricing-notes">
  <h2>Questions</h2>
  <p><strong>What happens to my artworks if I downgrade?</strong> Nothing is deleted. Every registered work stays protected and its
  certificate and blockchain timestamp stay valid. Monitoring and searches drop to the limits of the Free plan, and you
  cannot register new works above the limit.</p>
  <p><strong>Can I cancel any time?</strong> Yes. Cancel in one click under Billing. Your plan stays active until the end of the period you paid for.</p>
  <p><strong>How do payments work?</strong> Payments are handled by Stripe. We never see or store your card details. Receipts and invoices are available under Billing.</p>
  <p><strong>Why is there a free plan?</strong> Every registered work makes everyone safer: copies found for one artist reveal shops that are then checked for everyone's work.</p>
</div>`;
}

export function billingPage({ cfg, csrf, user, billing, usage, interval, error }) {
  const p = PLANS[user.plan] || PLANS.free;
  const meter = (label, used, max) => html`<div class="meter">
    <div class="meter-head"><span>${label}</span><span>${used} / ${max}</span></div>
    <progress class="${used >= max ? 'full' : ''}" max="${Math.max(max, 1)}" value="${Math.min(used, Math.max(max, 1))}"></progress>
  </div>`;
  const sub = user.stripe_subscription_id && user.sub_status;
  const statusLine = sub
    ? user.sub_status === 'past_due'
      ? html`<div class="flash flash-err">Your last payment failed. Update your card to keep your plan.</div>`
      : user.sub_cancel_at_period_end
        ? html`<p>Your ${PLANS[user.sub_plan]?.name} subscription ends on <strong>${fmtDay(user.sub_period_end)}</strong>. You can resume it before then.</p>`
        : user.sub_status === 'canceled'
          ? html`<p class="muted">Your subscription has ended.</p>`
          : html`<p>${PLANS[user.sub_plan]?.name}, billed ${user.sub_interval === 'yearly' ? 'yearly' : 'monthly'}. Renews on <strong>${fmtDay(user.sub_period_end)}</strong>.</p>`
    : '';
  return html`
${pageHead('Billing')}
${errorBlock(error)}
<div class="two-col">
  <section class="card-form">
    <h2>Your plan: ${p.name}</h2>
    ${user.comp_plan && PLANS[user.comp_plan] && (!sub || user.comp_plan === user.plan) ? html`<p class="small">${PLANS[user.comp_plan].name} is included for free during the beta. Thank you for helping us test!</p>` : ''}
    ${statusLine}
    ${p.key === 'free' && !sub ? html`<p class="small muted">Your works are registered and protected. Upgrade for weekly web searches, new Etsy and eBay listings and close watch.</p>` : ''}
    ${user.stripe_customer_id && billing.enabled
      ? html`<form method="post" action="/dashboard/billing/portal">${csrfField(csrf)}
          <button class="btn btn-ghost">Manage subscription, card and receipts</button></form>`
      : ''}
    ${!user.email_verified_at ? html`<p class="flash flash-err">Verify your e-mail address to upgrade.</p>` : ''}
  </section>
  <section class="card-form">
    <h2>Usage</h2>
    ${meter('Registered artworks', usage.artworks, p.artworks)}
    ${meter('Monitored pages', usage.watches, p.watches)}
    ${meter('Works on close watch', usage.hot, p.hot)}
  </section>
</div>
<h2>Plans</h2>
${plansGrid({ cfg, user, billing, csrf, interval })}
<p class="small muted">By upgrading you agree to the <a href="/terms">terms</a>. Subscriptions renew automatically until cancelled.</p>`;
}
