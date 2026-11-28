import { html } from '../html.js';

export const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

const FLASH = {
  welcome: ['ok', 'Welcome! Your account is ready. We sent you an e-mail: open the link in it to confirm your address.'],
  'email-verified': ['ok', 'Thank you, your e-mail address is confirmed.'],
  'verify-sent': ['ok', 'A new confirmation link has been sent. It is valid for 48 hours.'],
  'email-change-sent': ['ok', 'We sent a confirmation link to your new address. Your e-mail changes when you open it.'],
  'billing-success': ['ok', 'Thank you! Your payment went through. Your new plan is active as soon as Stripe confirms it, usually within seconds.'],
  'billing-cancelled': ['err', 'Checkout was cancelled. Nothing was charged.'],
  'plan-required': ['err', 'That is not included in your plan, or you have reached its limit. See Billing to upgrade.'],
  uploaded: ['ok', 'Artwork registered and protected.'],
  updated: ['ok', 'Changes saved.'],
  deleted: ['ok', 'Deleted.'],
  'password-changed': ['ok', 'Password changed. Other sessions have been signed out.'],
  'reset-sent': ['ok', 'If an account exists for that address, a reset link has been sent.'],
  'reset-done': ['ok', 'Password updated. You can sign in now.'],
  'watch-added': ['ok', 'Page added to monitoring. It has been scanned once and will be re-scanned automatically.'],
  'dispute-sent': ['ok', 'Thank you. Your report has been received and will be reviewed.'],
  'signed-out': ['ok', 'You have been signed out.'],
  'market-done': ['ok', 'Marketplace search finished. See the result below; new matches are listed under Matches.'],
  'market-recent': ['err', 'This artwork was searched on the marketplaces less than an hour ago.'],
  'market-unavailable': ['err', 'Marketplace search is not configured on this server yet.'],
  'search-done': ['ok', 'Web search finished. See the result below; new matches are listed under Matches.'],
  'search-recent': ['err', 'This artwork was searched in the last 24 hours. Try again tomorrow.'],
  'search-budget': ['err', "This month's web search budget has been used up. Searches resume next month."],
  'search-unavailable': ['err', 'Web search is not configured on this server yet.'],
  'search-failed': ['err', 'The web search could not be completed. See the status below and try again later.'],
};

export function flash(key) {
  const f = FLASH[key];
  return f ? html`<div class="flash flash-${f[0]}" role="status">${f[1]}</div>` : '';
}

export function layout(ctx, { title, body, description = '', wide = false }) {
  const { cfg, user, csrf, path = '' } = ctx;
  const nav = (href, label) => html`<a href="${href}" class="${path === href || (href !== '/' && path.startsWith(href)) ? 'active' : ''}">${label}</a>`;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noai, noimageai">
<meta name="description" content="${description || `${cfg.siteName} protects artists' work from AI scraping and print-on-demand theft.`}">
<title>${title ? `${title} · ${cfg.siteName}` : cfg.siteName}</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>${cfg.siteName}</a>
    <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Toggle menu">
    <label for="nav-toggle" class="nav-burger" aria-hidden="true"><span></span></label>
    <nav class="site-nav">
      ${nav('/gallery', 'Gallery')}
      ${nav('/how-it-works', 'How it works')}
      ${nav('/check', 'Find copies')}
      ${nav('/verify', 'Verify')}
      ${nav('/pricing', 'Pricing')}
      ${user
        ? html`${nav('/dashboard', 'Dashboard')}${user.is_admin ? nav('/admin', 'Admin') : ''}
          <form method="post" action="/logout" class="inline">${csrfField(csrf)}<button class="link">Sign out</button></form>`
        : html`${nav('/login', 'Sign in')}<a href="/signup" class="btn btn-small">Join free</a>`}
    </nav>
  </div>
</header>
${user && !user.email_verified_at
  ? html`<div class="verify-banner" role="status"><div class="wrap">
      <span>Confirm your e-mail address (${user.email}) to get alerts, generate takedown notices and upgrade.</span>
      <form method="post" action="/dashboard/verify-email/resend" class="inline">${csrfField(csrf)}<button class="link">Send the link again</button></form>
    </div></div>`
  : ''}
<main id="main" class="${wide ? 'wrap wide' : 'wrap'}">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <strong>${cfg.siteName}</strong>
      <p class="muted small">All works are the property of their respective artists. Text and data mining and AI training are
      expressly reserved under Art. 4(3) of Directive (EU) 2019/790.</p>
    </div>
    <nav class="footer-nav">
      <a href="/how-it-works">How it works</a>
      <a href="/verify">Verify a certificate</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
      <a href="/.well-known/signing-key.pem">Signing key</a>
    </nav>
  </div>
</footer>
<script src="/static/app.js"></script>
</body>
</html>`;
}

export const pageHead = (title, sub, actions = '') => html`
<div class="page-head">
  <div><h1>${title}</h1>${sub ? html`<p class="lead">${sub}</p>` : ''}</div>
  ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
</div>`;

export const notFound = () => html`
<div class="empty">
  <h1>Not found</h1>
  <p>The page you are looking for does not exist or has been removed.</p>
  <p><a class="btn" href="/">Go home</a></p>
</div>`;

export const errorBlock = (msg) => (msg ? html`<div class="flash flash-err" role="alert">${msg}</div>` : '');
