import { html, fmtDate, fmtDay } from '../html.js';
import { csrfField, pageHead, errorBlock } from './layout.js';
import { NOTICE_TYPES } from '../takedown.js';

export const STATUS = {
  new: 'New',
  confirmed: 'Confirmed copy',
  reported: 'Reported',
  removed: 'Removed',
  dismissed: 'Not a copy',
};

const tabs = (path) => {
  const t = (href, label) => html`<a href="${href}" class="${path === href ? 'active' : ''}">${label}</a>`;
  return html`<nav class="tabs">
    ${t('/dashboard', 'Overview')}
    ${t('/dashboard/artworks', 'Artworks')}
    ${t('/dashboard/monitor', 'Monitor')}
    ${t('/dashboard/matches', 'Matches')}
    ${t('/dashboard/settings', 'Settings')}
  </nav>`;
};

export const dashShell = (path, body) => html`${tabs(path)}${body}`;

const SOURCES = {
  search: ['web search', 'Found by reverse image search'],
  offender: ['repeat seller', 'Found in a shop where copies were found before'],
  etsy: ['Etsy', 'Found among new Etsy listings'],
  ebay: ['eBay', 'Found among new eBay listings'],
};
const sourceBadge = (m) => (SOURCES[m.source] ? html`<span class="badge" title="${SOURCES[m.source][1]}">${SOURCES[m.source][0]}</span>` : '');
const similarity = (m) => (m.verified === 0 || m.distance < 0 ? html`<span class="muted">unverified</span>` : `${m.distance}/64`);

const statusBadge = (s) => html`<span class="badge badge-${s}">${STATUS[s] || s}</span>`;
const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

export function overview({ user, stats, recentMatches, artworksById }) {
  return dashShell(
    '/dashboard',
    html`
${pageHead(`Hi, ${user.display_name}`, null, html`<a class="btn" href="/dashboard/upload">+ Register artwork</a>`)}
<div class="stats">
  <a class="stat" href="/dashboard/artworks"><strong>${stats.artworks}</strong><span>protected artworks</span></a>
  <a class="stat" href="/dashboard/monitor"><strong>${stats.watches}</strong><span>monitored pages</span></a>
  <a class="stat ${stats.newMatches ? 'stat-alert' : ''}" href="/dashboard/matches?status=new"><strong>${stats.newMatches}</strong><span>new matches</span></a>
  <a class="stat" href="/dashboard/matches?status=removed"><strong>${stats.removed}</strong><span>copies taken down</span></a>
</div>
${!stats.artworks
  ? html`<div class="callout">
      <h3>Get started in three steps</h3>
      <ol>
        <li><a href="/dashboard/upload">Register your first artwork</a>. You get a signed certificate and a blockchain timestamp.</li>
        <li><a href="/dashboard/monitor">Add shop pages to monitor</a>, e.g. search results for your artwork's subject on Etsy or a suspicious store.</li>
        <li>Review matches and send the generated takedown notices.</li>
      </ol>
    </div>`
  : ''}
<h2>Latest matches</h2>
${recentMatches.length ? matchTable(recentMatches, artworksById) : html`<p class="empty">No matches yet. That's good news.</p>`}
<p class="small muted">Your public profile: <a href="/artist/${user.handle}">/artist/${user.handle}</a></p>`,
  );
}

function matchTable(rows, artworksById) {
  return html`<div class="table-wrap"><table class="table">
<thead><tr><th>Artwork</th><th>Found on</th><th>Similarity</th><th>Found</th><th>Status</th><th></th></tr></thead>
<tbody>${rows.map((m) => {
    const a = artworksById[m.artwork_id];
    return html`<tr>
    <td>${a ? a.title : m.artwork_id}</td>
    <td><a href="${m.page_url}" rel="noopener noreferrer nofollow" target="_blank">${hostOf(m.page_url)}</a> ${sourceBadge(m)}</td>
    <td>${similarity(m)}</td>
    <td>${fmtDay(m.found_at)}</td>
    <td>${statusBadge(m.status)}</td>
    <td><a href="/dashboard/matches/${m.id}">Review →</a></td>
  </tr>`;
  })}</tbody></table></div>`;
}

export function artworksList({ items, thumb }) {
  return dashShell(
    '/dashboard/artworks',
    html`
${pageHead('Your artworks', `${items.length} registered`, html`<a class="btn" href="/dashboard/upload">+ Register artwork</a>`)}
${items.length
  ? html`<div class="grid">${items.map(
      (a) => html`<a class="card" href="/dashboard/artworks/${a.id}">
        <div class="card-img"><img src="${thumb(a.id)}" alt="${a.title}" loading="lazy"></div>
        <div class="card-body"><strong>${a.title}</strong>
          <span class="muted small">${fmtDay(a.created_at)}${a.visibility === 'unlisted' ? ' · unlisted' : ''}</span>
          ${a.hidden_at ? html`<span class="badge badge-new">Hidden by moderators</span>` : ''}</div>
      </a>`,
    )}</div>`
  : html`<p class="empty">Nothing registered yet. <a href="/dashboard/upload">Register your first artwork →</a></p>`}`,
  );
}

export function uploadPage({ csrf, error, values = {}, conflict, searchEnabled }) {
  return dashShell(
    '/dashboard/artworks',
    html`
${pageHead('Register an artwork', 'Upload the original, full-resolution file. It is never published.')}
${errorBlock(error)}
${conflict ? html`<p class="small">Existing registration: <a href="/a/${conflict}">/a/${conflict}</a>. If you believe this is your work, use “Report a false claim” on that page.</p>` : ''}
<div class="two-col">
  <form method="post" action="/dashboard/upload" enctype="multipart/form-data" class="form card-form">
    ${csrfField(csrf)}
    <label>Original file <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/tiff" required>
      <small class="muted">JPEG, PNG, WebP or TIFF, up to 40 MB</small></label>
    <label>Title <input name="title" required maxlength="120" value="${values.title}"></label>
    <div class="row">
      <label>Year <input name="year" maxlength="10" value="${values.year}" inputmode="numeric"></label>
      <label>Medium <input name="medium" maxlength="80" value="${values.medium}" placeholder="e.g. Gouache on paper"></label>
    </div>
    <label>Description <textarea name="description" maxlength="2000" rows="3">${values.description}</textarea></label>
    <label>Search keywords (optional)
      <input name="keywords" maxlength="300" value="${values.keywords}" placeholder="e.g. sunset poster, minimalist landscape print">
      <small class="muted">How would a shop describe a copy? Up to three phrases, separated by commas. Used to search new marketplace listings. Defaults to the title.</small></label>
    <label>Visibility
      <select name="visibility">
        <option value="public">Public: shown in gallery and on your profile</option>
        <option value="unlisted" ${values.visibility === 'unlisted' ? 'selected' : ''}>Unlisted: registered and monitored, only visible by link</option>
      </select></label>
    ${searchEnabled
      ? html`<label class="check"><input type="checkbox" name="web_search" value="1" ${values.webSearch === false ? '' : 'checked'}>
          <span>Search the whole web for copies every week. A downscaled copy of the image is sent to our search provider for this; it is not published.</span></label>`
      : ''}
    <button class="btn">Register and protect</button>
  </form>
  <div class="aside">
    <h3>What happens</h3>
    <ul class="small">
      <li>The original is stored privately and never served.</li>
      <li>A watermarked preview (max 1000 px) is created for display.</li>
      <li>You get a signed certificate with the file's SHA-256 fingerprint.</li>
      <li>The fingerprint is timestamped in the Bitcoin blockchain via OpenTimestamps.</li>
      <li>Perceptual fingerprints let the monitor recognise copies.</li>
    </ul>
    <p class="small muted">Tip: keep your original file unchanged. Its exact bytes are your proof.</p>
  </div>
</div>`,
  );
}

export function artworkEdit({ csrf, a, src, matches, search, discovery, views = 0 }) {
  const hot = discovery.isHot(a);
  return dashShell(
    '/dashboard/artworks',
    html`
${pageHead(a.title, html`Registered ${fmtDate(a.created_at)} · <a href="/a/${a.id}">public page</a>`)}
<div class="two-col">
  <div>
    <img class="edit-img" src="${src}" alt="${a.title}">
    <h3>Matches for this artwork</h3>
    ${matches.length
      ? html`<ul class="plain">${matches.map((m) => html`<li><a href="/dashboard/matches/${m.id}">${hostOf(m.page_url)}</a> <span>${sourceBadge(m)} ${statusBadge(m.status)}</span></li>`)}</ul>`
      : html`<p class="muted small">None found yet.</p>`}
  </div>
  <div>
    <form method="post" action="/dashboard/artworks/${a.id}" class="form card-form">
      ${csrfField(csrf)}
      <label>Title <input value="${a.title}" disabled>
        <small class="muted">The title is part of the signed certificate and cannot be changed.</small></label>
      <div class="row">
        <label>Year <input name="year" maxlength="10" value="${a.year}"></label>
        <label>Medium <input name="medium" maxlength="80" value="${a.medium}"></label>
      </div>
      <label>Description <textarea name="description" maxlength="2000" rows="4">${a.description}</textarea></label>
      <label>Search keywords
        <input name="keywords" maxlength="300" value="${a.keywords}" placeholder="${a.title}">
        <small class="muted">Up to three phrases, separated by commas, that a shop might use for a copy.</small></label>
      <label>Visibility
        <select name="visibility">
          <option value="public">Public</option>
          <option value="unlisted" ${a.visibility === 'unlisted' ? 'selected' : ''}>Unlisted</option>
        </select></label>
      ${search.enabled
        ? html`<label class="check"><input type="checkbox" name="web_search" value="1" ${a.web_search ? 'checked' : ''}>
            <span>Search the whole web for copies every week (a downscaled copy is sent to our search provider)</span></label>`
        : ''}
      <button class="btn">Save</button>
    </form>
    <section class="card-form hotmode ${hot ? 'is-hot' : ''}">
      <h3>${hot ? '🔥 Close watch is on' : 'Close watch'}</h3>
      ${hot
        ? html`<p class="small">Until ${fmtDay(a.hot_until)} (${a.hot_reason}): searched every day instead of every week.</p>
          <form method="post" action="/dashboard/artworks/${a.id}/hot" class="inline">${csrfField(csrf)}<input type="hidden" name="on" value="0">
            <button class="btn btn-small btn-ghost">Turn off</button></form>`
        : html`<p class="small">Copies appear within days of a work starting to trend. Turn this on when it takes off and we search every day for a few weeks.
            It also turns on by itself when a copy is found or the artwork gets many views.</p>
          <form method="post" action="/dashboard/artworks/${a.id}/hot" class="inline">${csrfField(csrf)}<input type="hidden" name="on" value="1">
            <button class="btn btn-small">It's trending: watch closely</button></form>`}
      <p class="small muted">${views} view${views === 1 ? '' : 's'} on ARTGUARD in the last 7 days.</p>
    </section>
    ${discovery.enabled
      ? html`<section class="card-form">
          <h3>New marketplace listings</h3>
          <p class="small">Searches the newest listings on ${discovery.providers.join(' and ')} through their official APIs.</p>
          <p class="small">${a.last_market_search_at ? html`Last searched ${fmtDate(a.last_market_search_at)}: ${a.last_market_status}` : 'Not searched yet.'}</p>
          <form method="post" action="/dashboard/artworks/${a.id}/market" class="inline">${csrfField(csrf)}
            <button class="btn btn-small btn-ghost">Search new listings now</button></form>
        </section>`
      : ''}
    <section class="card-form websearch">
      <h3>Web search</h3>
      ${search.enabled
        ? html`<p class="small">${a.last_searched_at ? html`Last searched ${fmtDate(a.last_searched_at)}: ${a.last_search_status}` : 'Not searched yet.'}</p>
          <form method="post" action="/dashboard/artworks/${a.id}/search" class="inline">${csrfField(csrf)}
            <button class="btn btn-small btn-ghost">Search the web now</button></form>
          <p class="small muted">Finds pages anywhere on the web that show this artwork. Every result is checked against your
          registration before it is listed. At most once a day per artwork.</p>`
        : html`<p class="small muted">Not available on this server yet.</p>`}
    </section>
    <form method="post" action="/dashboard/artworks/${a.id}/delete" class="form danger-zone" data-confirm="Delete this artwork, its certificate and all matches permanently?">
      ${csrfField(csrf)}
      <h3>Delete artwork</h3>
      <p class="small muted">Removes the original, preview, certificate and matches. Your downloaded .ots proof stays valid.</p>
      <button class="btn btn-danger">Delete permanently</button>
    </form>
  </div>
</div>`,
  );
}

export function monitorPage({ csrf, watches, error, scanResult, artworkCount, cfg }) {
  return dashShell(
    '/dashboard/monitor',
    html`
${pageHead('Marketplace monitor', `Pages here are re-scanned every ${cfg.rescanHours} hours. New copies of your work are e-mailed to you.`)}
${!artworkCount ? html`<div class="flash flash-err">Register at least one artwork first. The monitor compares pages against your registered works.</div>` : ''}
${errorBlock(error)}
${scanResult
  ? html`<div class="flash ${scanResult.hits.length ? 'flash-err' : 'flash-ok'}">
      Scanned <a href="${scanResult.pageUrl}" rel="noopener noreferrer nofollow" target="_blank">${hostOf(scanResult.pageUrl)}</a>:
      ${scanResult.checked} of ${scanResult.found} images checked,
      <strong>${scanResult.hits.length} match${scanResult.hits.length === 1 ? '' : 'es'}</strong>${scanResult.created.length ? html` (${scanResult.created.length} new)` : ''}.
      ${scanResult.hits.length ? html`<a href="/dashboard/matches?status=new">Review →</a>` : ''}
    </div>`
  : ''}
<div class="two-col">
  <form method="post" action="/dashboard/monitor" class="form card-form">
    ${csrfField(csrf)}
    <label>Page URL <input type="url" name="url" required maxlength="2000" placeholder="https://www.etsy.com/search?q=..."></label>
    <label>Label (optional) <input name="label" maxlength="80" placeholder="e.g. Suspicious poster shop"></label>
    <div class="row-buttons">
      <button class="btn" name="mode" value="watch">Monitor this page</button>
      <button class="btn btn-ghost" name="mode" value="once">Scan once</button>
    </div>
  </form>
  <div class="aside">
    <h3>What to monitor</h3>
    <ul class="small">
      <li>Marketplace search results for your artwork's subject or style, e.g. “sunset poster minimalist”.</li>
      <li>Store pages of sellers who have copied you before.</li>
      <li>Individual product listings you suspect.</li>
    </ul>
    <p class="small muted">Pages that require login or are rendered entirely by JavaScript may return few images.</p>
  </div>
</div>
<h2>Monitored pages</h2>
${watches.length
  ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Page</th><th>Last checked</th><th>Result</th><th></th></tr></thead>
      <tbody>${watches.map(
        (w) => html`<tr class="${w.active ? '' : 'inactive'}">
          <td><a href="${w.url}" rel="noopener noreferrer nofollow" target="_blank">${w.label || hostOf(w.url)}</a>
            <div class="small muted trunc">${w.url}</div></td>
          <td class="nowrap">${w.last_checked_at ? fmtDate(w.last_checked_at) : 'Never'}</td>
          <td class="small">${w.last_status || ''}</td>
          <td class="actions">
            <form method="post" action="/dashboard/monitor/${w.id}/scan" class="inline">${csrfField(csrf)}<button class="link">Scan now</button></form>
            <form method="post" action="/dashboard/monitor/${w.id}/toggle" class="inline">${csrfField(csrf)}<button class="link">${w.active ? 'Pause' : 'Resume'}</button></form>
            <form method="post" action="/dashboard/monitor/${w.id}/delete" class="inline" data-confirm="Stop monitoring this page?">${csrfField(csrf)}<button class="link link-danger">Remove</button></form>
          </td>
        </tr>`,
      )}</tbody></table></div>`
  : html`<p class="empty">No monitored pages yet.</p>`}`,
  );
}

export function matchesPage({ rows, artworksById, status, counts }) {
  const filter = (key, label) =>
    html`<a href="/dashboard/matches${key ? `?status=${key}` : ''}" class="${status === key ? 'active' : ''}">${label} <span class="count">${counts[key || 'all'] || 0}</span></a>`;
  return dashShell(
    '/dashboard/matches',
    html`
${pageHead('Matches', 'Images that closely match your registered artworks. Review each one before taking action.')}
<nav class="filters">
  ${filter('', 'All')}${Object.entries(STATUS).map(([k, v]) => filter(k, v))}
</nav>
${rows.length ? matchTable(rows, artworksById) : html`<p class="empty">Nothing here.</p>`}`,
  );
}

export function matchDetail({ csrf, m, a, src, platform, noticeType, notice, user }) {
  const missingLegal = !user.legal_name || !user.postal_address;
  return dashShell(
    '/dashboard/matches',
    html`
${pageHead('Review match', html`Found ${fmtDate(m.found_at)}${m.source === 'search' ? ' by web search' : ''} · similarity ${similarity(m)}${m.verified === 0 ? '' : ' (0 = identical)'}`)}
${m.verified === 0
  ? html`<div class="flash flash-err">Unverified: the search provider reported this as an exact copy, but the image could not be downloaded to
      confirm it. Open the image and compare it yourself before sending a notice.</div>`
  : ''}
<div class="compare">
  <div>
    <h3>Your artwork</h3>
    <img src="${src}" alt="${a.title}">
    <p><a href="/a/${a.id}">${a.title}</a></p>
  </div>
  <div>
    <h3>Found image</h3>
    <div class="external-box">
      <p>For your safety, images from other sites are not embedded.</p>
      <a class="btn btn-ghost" href="${m.image_url}" rel="noopener noreferrer nofollow" target="_blank">Open found image ↗</a>
      <a class="btn btn-ghost" href="${m.page_url}" rel="noopener noreferrer nofollow" target="_blank">Open listing page ↗</a>
    </div>
    ${m.evidence_sha256 ? html`<p class="small muted">Evidence SHA-256 of the image as downloaded: <code class="hash">${m.evidence_sha256}</code></p>` : ''}
  </div>
</div>

<form method="post" action="/dashboard/matches/${m.id}" class="form card-form status-form">
  ${csrfField(csrf)}
  <label>Status
    <select name="status">${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}" ${m.status === k ? 'selected' : ''}>${v}</option>`)}</select></label>
  <label>Notes <textarea name="notes" rows="2" maxlength="2000">${m.notes}</textarea></label>
  <button class="btn btn-small">Save</button>
</form>

<section class="takedown">
  <h2>Take it down</h2>
  <div class="platform">
    <h3>${platform.name}</h3>
    <p>${platform.how}</p>
    <a class="btn" href="${platform.url}" rel="noopener noreferrer" target="_blank">Open reporting form ↗</a>
  </div>
  ${missingLegal
    ? html`<div class="flash flash-err">Formal notices require your legal name and postal address.
        <a href="/dashboard/settings">Add them in Settings</a> and they will be filled in automatically.</div>`
    : ''}
  <nav class="filters">
    ${Object.entries(NOTICE_TYPES).map(
      ([k, v]) => html`<a href="/dashboard/matches/${m.id}?notice=${k}" class="${noticeType === k ? 'active' : ''}">${v}</a>`,
    )}
  </nav>
  <label class="notice-label">Notice text (review and edit before sending)
    <textarea class="notice" id="notice-text" rows="22">${notice}</textarea></label>
  <div class="row-buttons">
    <button type="button" class="btn btn-ghost" data-copy="#notice-text">Copy to clipboard</button>
    <a class="btn btn-ghost" href="/dashboard/matches/${m.id}/notice.txt?notice=${noticeType}">Download .txt</a>
  </div>
  <p class="small muted">After sending, set the status to “Reported”. When the listing disappears, mark it “Removed”.</p>
</section>`,
  );
}

export function settingsPage({ csrf, user, error }) {
  return dashShell(
    '/dashboard/settings',
    html`
${pageHead('Settings')}
${errorBlock(error)}
<div class="settings">
  <form method="post" action="/dashboard/settings/profile" class="form card-form">
    ${csrfField(csrf)}
    <h2>Public profile</h2>
    <label>Artist name <input name="display_name" required maxlength="80" value="${user.display_name}">
      <small class="muted">Used in watermarks of new uploads. Existing certificates keep the name they were signed with.</small></label>
    <label>Bio <textarea name="bio" maxlength="600" rows="3">${user.bio}</textarea></label>
    <label>Website <input type="url" name="website" maxlength="200" value="${user.website}" placeholder="https://"></label>
    <button class="btn">Save profile</button>
  </form>

  <form method="post" action="/dashboard/settings/legal" class="form card-form">
    ${csrfField(csrf)}
    <h2>Details for takedown notices</h2>
    <p class="small muted">Private. Only used to pre-fill notices you generate. DMCA notices legally require a name, address and signature.</p>
    <label>Legal name <input name="legal_name" maxlength="120" value="${user.legal_name}" autocomplete="name"></label>
    <label>Postal address <textarea name="postal_address" maxlength="400" rows="3" autocomplete="street-address">${user.postal_address}</textarea></label>
    <button class="btn">Save details</button>
  </form>

  <form method="post" action="/dashboard/settings/password" class="form card-form">
    ${csrfField(csrf)}
    <h2>Password</h2>
    <label>Current password <input type="password" name="current" required autocomplete="current-password"></label>
    <label>New password <input type="password" name="password" required minlength="10" maxlength="200" autocomplete="new-password"></label>
    <button class="btn">Change password</button>
  </form>

  <form method="post" action="/dashboard/settings/delete" class="form card-form danger-zone" data-confirm="Delete your account and ALL artworks permanently? This cannot be undone.">
    ${csrfField(csrf)}
    <h2>Delete account</h2>
    <p class="small muted">Deletes your account, every original file, preview, certificate, monitored page and match. Signed in as ${user.email}.</p>
    <label>Confirm with your password <input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn btn-danger">Delete everything</button>
  </form>
</div>`,
  );
}
