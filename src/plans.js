// Plans and their limits. Prices shown on the site must match the prices
// configured in Stripe (STRIPE_PRICE_* environment variables).

export const PLANS = {
  free: {
    key: 'free',
    name: 'Free',
    rank: 0,
    price: { monthly: 0, yearly: 0 },
    artworks: 5,
    watches: 2,
    hot: 0, // artworks on close watch at the same time
    webSearchDays: 30, // how often opted-in works are searched on the web
    manualSearch: false,
    marketplaces: false,
  },
  artist: {
    key: 'artist',
    name: 'Artist',
    rank: 1,
    price: { monthly: 79, yearly: 790 },
    artworks: 50,
    watches: 20,
    hot: 5,
    webSearchDays: 7,
    manualSearch: true,
    marketplaces: true,
  },
  studio: {
    key: 'studio',
    name: 'Studio',
    rank: 2,
    price: { monthly: 199, yearly: 1990 },
    artworks: 300,
    watches: 100,
    hot: 30,
    webSearchDays: 7,
    manualSearch: true,
    marketplaces: true,
  },
};

export const PAID = ['artist', 'studio'];
export const planOf = (user) => PLANS[user?.plan] || PLANS.free;

/** SQL expression giving a per-plan value for the user aliased as `u`. */
export function planSql(field, alias = 'u') {
  const v = (p) => (typeof PLANS[p][field] === 'boolean' ? Number(PLANS[p][field]) : PLANS[p][field]);
  return `(CASE ${alias}.plan WHEN 'artist' THEN ${v('artist')} WHEN 'studio' THEN ${v('studio')} ELSE ${v('free')} END)`;
}

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

/**
 * Recomputes a user's effective plan: the better of a granted plan (beta,
 * admin) and an active Stripe subscription.
 */
export function syncPlan(db, userId) {
  const u = db.one('SELECT comp_plan, sub_plan, sub_status FROM users WHERE id = ?', userId);
  if (!u) return 'free';
  const candidates = ['free'];
  if (PLANS[u.comp_plan]) candidates.push(u.comp_plan);
  if (PLANS[u.sub_plan] && ACTIVE.has(u.sub_status)) candidates.push(u.sub_plan);
  const plan = candidates.sort((a, b) => PLANS[b].rank - PLANS[a].rank)[0];
  db.run('UPDATE users SET plan = ? WHERE id = ?', plan, userId);
  return plan;
}

export const fmtPrice = (amount, currency = 'SEK') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
