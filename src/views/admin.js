import { html, fmtDate, fmtDay } from '../html.js';
import { csrfField, pageHead } from './layout.js';

const tabs = (path) => {
  const t = (href, label) => html`<a href="${href}" class="${path === href ? 'active' : ''}">${label}</a>`;
  return html`<nav class="tabs">
    ${t('/admin', 'Overview')}${t('/admin/disputes', 'Disputes')}${t('/admin/users', 'Users')}${t('/admin/log', 'Audit log')}
  </nav>`;
};
const shell = (path, body) => html`<p class="eyebrow">Admin</p>${tabs(path)}${body}`;

const disputeBadge = (d) =>
  d.status === 'open'
    ? html`<span class="badge badge-new">Open</span>`
    : html`<span class="badge ${d.resolution === 'upheld' ? 'badge-removed' : ''}">${d.resolution === 'upheld' ? 'Upheld' : 'Rejected'}</span>`;

const disputeTable = (rows) =>
  rows.length
    ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Received</th><th>Artwork</th><th>Reported by</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(
          (d) => html`<tr>
            <td class="nowrap">${fmtDay(d.created_at)}</td>
            <td>${d.title ?? html`<span class="muted">deleted (${d.artwork_id})</span>`}${d.owner_handle ? html`<div class="small muted">@${d.owner_handle}</div>` : ''}</td>
            <td>${d.name}<div class="small muted">${d.email}</div></td>
            <td>${disputeBadge(d)}</td>
            <td><a href="/admin/disputes/${d.id}">Open →</a></td>
          </tr>`,
        )}</tbody></table></div>`
    : html`<p class="empty">Nothing here.</p>`;

export function overview({ stats, open }) {
  const stat = (n, label, href, alert) => html`<a class="stat ${alert && n ? 'stat-alert' : ''}" href="${href}"><strong>${n}</strong><span>${label}</span></a>`;
  return shell(
    '/admin',
    html`${pageHead('Moderation')}
<div class="stats">
  ${stat(stats.openDisputes, 'open disputes', '/admin/disputes', true)}
  ${stat(stats.users, 'users', '/admin/users')}
  ${stat(stats.artworks, 'artworks', '/admin/users')}
  ${stat(stats.suspended, 'suspended users', '/admin/users?filter=suspended')}
  ${stat(stats.hidden, 'hidden artworks', '/admin/users')}
  ${stat(stats.matches, 'matches found', '/admin')}
  ${stat(stats.watches, 'monitored pages', '/admin')}
  ${stat(stats.blockedWatches, 'pages blocking the monitor', '/admin')}
  ${stat(stats.searches, `web searches this month${stats.searchProvider ? ` (${stats.searchProvider})` : ''}`, '/admin')}
</div>
<h2>Open disputes</h2>
${disputeTable(open)}`,
  );
}

export function disputes({ rows, status }) {
  const f = (key, label) => html`<a href="/admin/disputes?status=${key}" class="${status === key ? 'active' : ''}">${label}</a>`;
  return shell('/admin/disputes', html`${pageHead('Disputes', 'Reports that an artwork was registered by someone who is not its author.')}
<nav class="filters">${f('open', 'Open')}${f('resolved', 'Resolved')}${f('all', 'All')}</nav>
${disputeTable(rows)}`);
}

const actionForm = (csrf, action, label, { danger = false, confirm = '', note = true, extra = '' } = {}) => html`
<form method="post" action="${action}" class="form admin-action" ${confirm ? html`data-confirm="${confirm}"` : ''}>
  ${csrfField(csrf)}${extra}
  ${note ? html`<input name="note" maxlength="500" placeholder="Reason (shown to the people notified)">` : ''}
  <button class="btn btn-small ${danger ? 'btn-danger' : 'btn-ghost'}">${label}</button>
</form>`;

export function disputeDetail({ csrf, d, a, src, owner, ownerStats, others }) {
  return shell(
    '/admin/disputes',
    html`${pageHead(`Dispute #${d.id}`, html`Received ${fmtDate(d.created_at)} · ${disputeBadge(d)}`)}
<div class="two-col">
  <div>
    <section class="card-form">
      <h3>Report</h3>
      <p><strong>${d.name}</strong> &lt;${d.email}&gt;</p>
      <p class="desc">${d.message}</p>
      ${d.status !== 'open' ? html`<p class="small muted">Resolved ${fmtDate(d.resolved_at)}: ${d.resolution}</p>` : ''}
    </section>
    ${others.length
      ? html`<h3>Other disputes from this address or about this artwork</h3>
        <ul class="plain">${others.map((o) => html`<li><a href="/admin/disputes/${o.id}">#${o.id} · ${fmtDay(o.created_at)}</a> ${disputeBadge(o)}</li>`)}</ul>`
      : ''}
  </div>
  <div>
    ${a
      ? html`<section class="card-form">
          <h3>Artwork</h3>
          <img class="edit-img" src="${src}" alt="${a.title}">
          <p><a href="/a/${a.id}">${a.title}</a>${a.hidden_at ? html` <span class="badge badge-new">Hidden</span>` : ''}</p>
          <dl class="kv small">
            <dt>Registered</dt><dd>${fmtDate(a.created_at)}</dd>
            <dt>Original</dt><dd>${a.width} × ${a.height} px ${a.format.toUpperCase()}</dd>
            <dt>SHA-256</dt><dd><code class="hash">${a.sha256}</code></dd>
          </dl>
        </section>`
      : html`<p class="flash flash-err">The artwork has been deleted.</p>`}
    ${owner
      ? html`<section class="card-form">
          <h3>Owner</h3>
          <p><a href="/admin/users/${owner.id}">${owner.display_name}</a> (@${owner.handle}) · ${owner.email}
            ${owner.suspended_at ? html` <span class="badge badge-new">Suspended</span>` : ''}</p>
          <p class="small muted">Joined ${fmtDay(owner.created_at)} · ${ownerStats.artworks} artworks · ${ownerStats.disputes} disputes against them</p>
        </section>`
      : ''}
  </div>
</div>
${d.status === 'open'
  ? html`<h2>Decision</h2>
    <p class="small muted">Upholding hides the artwork, which also stops it from blocking the real author's registration, and notifies both parties.
    Rejecting keeps it as it is and notifies the reporter.</p>
    <form method="post" action="/admin/disputes/${d.id}/uphold" class="form card-form decision" data-confirm="Apply this decision and notify the people involved?">
      ${csrfField(csrf)}
      <label>Reason (included in the e-mails)
        <textarea name="note" rows="2" maxlength="500" placeholder="e.g. Earlier publication on Instagram verified."></textarea></label>
      <div class="row-buttons">
        <button class="btn btn-danger" name="suspend" value="0">Uphold: hide artwork</button>
        <button class="btn btn-danger" name="suspend" value="1">Uphold and suspend owner</button>
        <button class="btn btn-ghost" formaction="/admin/disputes/${d.id}/reject">Reject report</button>
      </div>
    </form>`
  : ''}`,
  );
}

export function users({ rows, q, filter }) {
  return shell(
    '/admin/users',
    html`${pageHead('Users')}
<form method="get" action="/admin/users" class="search-row">
  <input name="q" value="${q}" placeholder="Search e-mail, handle or name">
  <select name="filter"><option value="">All</option><option value="suspended" ${filter === 'suspended' ? 'selected' : ''}>Suspended</option><option value="admin" ${filter === 'admin' ? 'selected' : ''}>Admins</option></select>
  <button class="btn btn-small">Search</button>
</form>
${rows.length
  ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>User</th><th>Joined</th><th>Artworks</th><th>Disputes</th><th>Status</th></tr></thead>
      <tbody>${rows.map(
        (u) => html`<tr>
          <td><a href="/admin/users/${u.id}">${u.display_name}</a><div class="small muted">@${u.handle} · ${u.email}</div></td>
          <td class="nowrap">${fmtDay(u.created_at)}</td>
          <td>${u.artworks}</td>
          <td>${u.disputes}</td>
          <td>${u.suspended_at ? html`<span class="badge badge-new">Suspended</span>` : u.is_admin ? html`<span class="badge">Admin</span>` : ''}</td>
        </tr>`,
      )}</tbody></table></div>
    <p class="small muted">Showing up to 100 users.</p>`
  : html`<p class="empty">No users found.</p>`}`,
  );
}

export function userDetail({ csrf, u, items, thumb, disputes: ds, watches }) {
  return shell(
    '/admin/users',
    html`${pageHead(u.display_name, html`@${u.handle} · ${u.email} · joined ${fmtDay(u.created_at)}${u.is_admin ? html` · <span class="badge">Admin</span>` : ''}`)}
${u.suspended_at
  ? html`<div class="flash flash-err">Suspended ${fmtDate(u.suspended_at)}${u.suspended_reason ? html`: ${u.suspended_reason}` : ''}</div>
    ${actionForm(csrf, `/admin/users/${u.id}/unsuspend`, 'Lift suspension', { note: false })}`
  : u.is_admin
    ? html`<p class="small muted">Admins cannot be suspended from the web. Revoke with <code>node scripts/admin.js revoke</code> first.</p>`
    : actionForm(csrf, `/admin/users/${u.id}/suspend`, 'Suspend user', { danger: true, confirm: 'Suspend this user? They are signed out, their works are hidden and their monitor stops.' })}
<h2>Artworks (${items.length})</h2>
${items.length
  ? html`<div class="grid">${items.map(
      (a) => html`<div class="card">
        <a class="card-img" href="/a/${a.id}"><img src="${thumb(a.id)}" alt="${a.title}" loading="lazy"></a>
        <div class="card-body">
          <strong>${a.title}</strong>
          <span class="small muted">${fmtDay(a.created_at)}</span>
          ${a.hidden_at ? html`<span class="badge badge-new">Hidden</span>` : ''}
          ${a.hidden_at
            ? actionForm(csrf, `/admin/artworks/${a.id}/unhide`, 'Unhide', { note: false })
            : actionForm(csrf, `/admin/artworks/${a.id}/hide`, 'Hide', { confirm: 'Hide this artwork from the public?' })}
          ${actionForm(csrf, `/admin/artworks/${a.id}/delete`, 'Delete', { danger: true, confirm: 'Delete this artwork and its files permanently?' })}
        </div>
      </div>`,
    )}</div>`
  : html`<p class="empty">No artworks.</p>`}
<h2>Disputes against this user</h2>
${ds.length ? html`<ul class="plain">${ds.map((d) => html`<li><a href="/admin/disputes/${d.id}">#${d.id} · ${d.title ?? d.artwork_id} · ${fmtDay(d.created_at)}</a> ${disputeBadge(d)}</li>`)}</ul>` : html`<p class="muted small">None.</p>`}
<h2>Monitored pages (${watches.length})</h2>
${watches.length ? html`<ul class="plain small">${watches.map((w) => html`<li><span class="trunc">${w.url}</span><span class="muted">${w.last_status || ''}</span></li>`)}</ul>` : html`<p class="muted small">None.</p>`}`,
  );
}

export function log({ rows }) {
  return shell(
    '/admin/log',
    html`${pageHead('Audit log', 'Every moderation action, newest first.')}
${rows.length
  ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Note</th></tr></thead>
      <tbody>${rows.map(
        (r) => html`<tr><td class="nowrap">${fmtDate(r.created_at)}</td><td>${r.admin_handle ? `@${r.admin_handle}` : '-'}</td>
          <td><code>${r.action}</code></td><td>${r.target}</td><td class="small">${r.note}</td></tr>`,
      )}</tbody></table></div>`
  : html`<p class="empty">No actions yet.</p>`}`,
  );
}
