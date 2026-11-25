import { html, fmtDate, fmtDay } from '../html.js';
import { csrfField, pageHead, errorBlock } from './layout.js';

export const artCard = (a, src, extra = '') => html`
<a class="card" href="/a/${a.id}">
  <div class="card-img"><img src="${src}" alt="${a.title} by ${a.display_name}" loading="lazy" draggable="false"></div>
  <div class="card-body">
    <strong>${a.title}</strong>
    <span class="muted">${a.display_name}</span>
    ${extra}
  </div>
</a>`;

const feature = (icon, title, text) => html`
<div class="feature">
  <div class="feature-icon" aria-hidden="true">${icon}</div>
  <h3>${title}</h3>
  <p>${text}</p>
</div>`;

export function home({ cfg, recent, thumb, user }) {
  return html`
<section class="hero">
  <div class="hero-text">
    <p class="eyebrow">For illustrators, painters & poster artists</p>
    <h1>Show your art.<br>Keep it yours.</h1>
    <p class="lead">Print-on-demand shops use AI to scrape trending artwork and sell it as posters within days.
    ${cfg.siteName} gives you a portfolio they can't print from, proof that you made it first, and a monitor that finds the copies for you.</p>
    <div class="hero-cta">
      ${user ? html`<a class="btn btn-lg" href="/dashboard/upload">Register an artwork</a>` : html`<a class="btn btn-lg" href="/signup">Protect your work, free</a>`}
      <a class="btn btn-lg btn-ghost" href="/how-it-works">How it works</a>
    </div>
  </div>
  <div class="hero-art" aria-hidden="true">
    <div class="hero-frame">
      <div class="hero-wm">© YOUR NAME · ${cfg.host}</div>
    </div>
  </div>
</section>

<section class="features">
  ${feature('◐', 'Never expose the original', 'Your full-resolution file is stored privately and never served. Visitors only ever see a downscaled, watermarked preview that is useless for printing.')}
  ${feature('✕', 'Blocks AI scrapers', 'Known AI crawlers are refused, every image URL expires within minutes, and a machine-readable legal reservation forbids text and data mining of your work.')}
  ${feature('✓', 'Proof you made it first', 'Each registration gets a cryptographically signed certificate and a timestamp anchored in the Bitcoin blockchain through OpenTimestamps, independent of us.')}
  ${feature('⌕', 'Finds the copies', 'Add shop and listing pages to your monitor. We re-scan them daily, recognise your work even when resized, recoloured or shown in a frame, and alert you.')}
  ${feature('⚑', 'One-click takedowns', 'Every match comes with a ready-to-send DMCA or EU Digital Services Act notice and a direct link to the right marketplace form.')}
  ${feature('◇', 'Anti claim-jacking', 'Nobody can register a work that is already registered by another artist, and anyone can report a false claim.')}
</section>

${recent.length
  ? html`<section>
      <div class="section-head"><h2>Recently protected</h2><a href="/gallery">View gallery →</a></div>
      <div class="grid">${recent.map((a) => artCard(a, thumb(a.id)))}</div>
    </section>`
  : ''}

<section class="cta-band">
  <h2>Your art deserves better than a stolen poster on a marketplace.</h2>
  <p>Free while in beta. No credit card. Delete your account and every file at any time.</p>
  <a class="btn btn-lg btn-light" href="${user ? '/dashboard/upload' : '/signup'}">Get started</a>
</section>`;
}

export function howItWorks({ cfg }) {
  return html`
${pageHead('How it works', 'What we do to protect your work, and what no service can promise.')}
<div class="prose">
  <h2>1. Register your artwork</h2>
  <p>Upload the original file (JPEG, PNG, WebP or TIFF, up to 40 MB). The original is stored privately on our servers and
  <strong>is never made available through any URL</strong>. We generate:</p>
  <ul>
    <li>a public preview of at most 1000 px, compressed, with a full-surface diagonal watermark carrying your name and the artwork's permanent link;</li>
    <li>copyright and "no AI training" statements embedded in the preview's EXIF metadata (location and camera metadata are stripped);</li>
    <li>a <strong>SHA-256 fingerprint</strong> of the exact original file, and perceptual fingerprints used to recognise copies;</li>
    <li>a <strong>signed registration certificate</strong> (Ed25519) that anyone can verify against our <a href="/.well-known/signing-key.pem">published key</a>;</li>
    <li>an <strong>OpenTimestamps proof</strong>: the fingerprint is submitted to public calendar servers and anchored in the Bitcoin blockchain within a few hours. Download the <code>.ots</code> file from the artwork page and keep it with your original. It proves the file existed at that time, even if ${cfg.siteName} disappears.</li>
  </ul>

  <h2>2. Show it without handing it over</h2>
  <p>Your portfolio and artwork pages are public, but scrapers get very little:</p>
  <ul>
    <li>known AI and dataset crawlers (GPTBot, CCBot, Bytespider, img2dataset and others) are refused;</li>
    <li>image URLs are signed and expire after ten minutes, so they cannot be hot-linked from a shop or collected into a dataset;</li>
    <li>scripting clients and headless browsers are blocked from image URLs, and each visitor is rate-limited;</li>
    <li>every response carries <code>robots</code>, <code>X-Robots-Tag: noai</code> and TDMRep reservations. Under Art. 4(3) of the EU DSM Directive, an explicit machine-readable reservation means the text-and-data-mining exception does not apply to your work.</li>
  </ul>

  <h2>3. Find the copies</h2>
  <p>Add the URL of a suspicious shop, listing or search-results page to your monitor. We download every product image on the page,
  compare it with your registered works and repeat the scan every ${cfg.rescanHours} hours. Matching tolerates resizing, compression,
  colour changes, light cropping and many "poster in a frame" mock-ups. When something matches you get an e-mail.</p>
  <p>You can also <a href="/check">upload any image</a> to see whether it matches a registered work.</p>
  <p><strong>Web search.</strong> For artworks where you turn it on, we also run a reverse image search across the whole web
  every week, so copies are found even in shops you have never heard of. Every result is downloaded and checked against your
  registration before it is listed, so similar-looking work by other artists is not reported.</p>
  <p><strong>New listings, fast.</strong> Search engines can take weeks to find a new listing, so we also check the newest Etsy and
  eBay listings directly through their official APIs. Shops where a copy was found once are re-checked every day for every
  artist's work. Sellers of stolen posters rarely stop at one. When an artwork starts trending, or a first copy turns up,
  we put it on close watch and search for it every day for a few weeks.</p>

  <h2>4. Get it taken down</h2>
  <p>For every match we generate a DMCA notice (US platforms) or an EU Digital Services Act notice, pre-filled with your details,
  the infringing URL and your registration evidence, and link to the right marketplace reporting form.</p>

  <h2>What we cannot promise</h2>
  <div class="callout">
    <p>Anything shown on a screen can be photographed or screenshotted. No service can make a visible image impossible to copy.
    What ${cfg.siteName} does is make the copy that <em>can</em> be taken worthless for printing, make bulk scraping hard and legally
    unambiguous, give you strong evidence of authorship, and do the tedious work of finding and reporting infringements.</p>
    <p>Matching uses perceptual fingerprints. Heavy edits, large crops or a work shown small inside a busy photo may not be
    recognised. Always review a match before sending a notice. A takedown notice is a legal statement made by you.</p>
  </div>
</div>`;
}

export function gallery({ items, thumb, page, pages }) {
  return html`
${pageHead('Gallery', 'Recently registered public works. Every image is a watermarked preview, never the original.')}
${items.length ? html`<div class="grid">${items.map((a) => artCard(a, thumb(a.id)))}</div>` : html`<p class="empty">No public artworks yet.</p>`}
${pages > 1
  ? html`<nav class="pager">
      ${page > 1 ? html`<a class="btn btn-ghost" href="/gallery?page=${page - 1}">← Newer</a>` : html`<span></span>`}
      <span class="muted">Page ${page} of ${pages}</span>
      ${page < pages ? html`<a class="btn btn-ghost" href="/gallery?page=${page + 1}">Older →</a>` : html`<span></span>`}
    </nav>`
  : ''}`;
}

export function artistPage({ artist, items, thumb }) {
  let site = null;
  try {
    const u = new URL(artist.website);
    if (/^https?:$/.test(u.protocol)) site = u.href;
  } catch {
    /* no valid website */
  }
  return html`
<section class="artist-head">
  <div class="avatar" aria-hidden="true">${artist.display_name.slice(0, 1).toUpperCase()}</div>
  <div>
    <h1>${artist.display_name}</h1>
    <p class="muted">@${artist.handle} · member since ${fmtDay(artist.created_at)}</p>
    ${artist.bio ? html`<p class="bio">${artist.bio}</p>` : ''}
    ${site ? html`<p><a href="${site}" rel="nofollow noopener" target="_blank">${site.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></p>` : ''}
  </div>
</section>
${items.length ? html`<div class="grid">${items.map((a) => artCard({ ...a, display_name: artist.display_name }, thumb(a.id)))}</div>` : html`<p class="empty">No public artworks yet.</p>`}`;
}

export function artworkPage({ cfg, a, src, isOwner, csrf, certValid }) {
  const otsLabel = { queued: 'Queued for submission', pending: 'Submitted - confirmed in the Bitcoin blockchain within a few hours', failed: 'Calendar unreachable - retrying automatically' }[a.ots_status];
  return html`
${a.hidden_at || a.owner_suspended_at
  ? html`<div class="flash flash-err">This artwork is hidden by moderators${a.hidden_reason ? html`: ${a.hidden_reason}` : ''}.
      Only its owner and moderators can see this page.</div>`
  : ''}
<div class="artwork">
  <figure class="artwork-figure">
    <img src="${src}" alt="${a.title} by ${a.display_name}" draggable="false">
    <figcaption class="muted small">Watermarked preview. The original is never published.</figcaption>
  </figure>
  <div class="artwork-side">
    <h1>${a.title}</h1>
    <p class="by">by <a href="/artist/${a.handle}">${a.display_name}</a>${a.year ? html` · ${a.year}` : ''}</p>
    ${a.medium ? html`<p class="muted">${a.medium}</p>` : ''}
    ${a.description ? html`<p class="desc">${a.description}</p>` : ''}
    ${isOwner ? html`<p><a class="btn btn-ghost btn-small" href="/dashboard/artworks/${a.id}">Edit artwork</a></p>` : ''}

    <section class="cert">
      <div class="cert-head">
        <h2>Registration certificate</h2>
        <span class="badge ${certValid ? 'badge-ok' : 'badge-err'}">${certValid ? '✓ Signature valid' : '✕ Signature invalid'}</span>
      </div>
      <dl>
        <dt>Artwork ID</dt><dd><code>${a.id}</code></dd>
        <dt>Registered</dt><dd>${fmtDate(a.created_at)}</dd>
        <dt>Artist</dt><dd>${a.display_name} (@${a.handle})</dd>
        <dt>Original</dt><dd>${a.width} × ${a.height} px, ${a.format.toUpperCase()}</dd>
        <dt>SHA-256</dt><dd><code class="hash">${a.sha256}</code></dd>
        <dt>Blockchain timestamp</dt><dd>${otsLabel}</dd>
      </dl>
      <div class="cert-actions">
        <a class="btn btn-small btn-ghost" href="/a/${a.id}/certificate.json">Signed certificate (JSON)</a>
        ${a.ots_proof ? html`<a class="btn btn-small btn-ghost" href="/a/${a.id}/proof.ots">OpenTimestamps proof (.ots)</a>` : ''}
      </div>
      <p class="small muted">Only the artist holds the original file. Anyone can confirm that a file is the registered original at
      <a href="/verify">${cfg.host}/verify</a>, without uploading it to a third party.</p>
    </section>

    ${!isOwner
      ? html`<details class="dispute">
          <summary>Is this your work? Report a false claim</summary>
          <form method="post" action="/a/${a.id}/dispute" class="form">
            ${csrfField(csrf)}
            <label>Your name <input name="name" required maxlength="100"></label>
            <label>E-mail <input type="email" name="email" required maxlength="200"></label>
            <label>Details and evidence (e.g. links to where you published it earlier)
              <textarea name="message" required maxlength="4000" rows="4"></textarea></label>
            <button class="btn btn-small">Send report</button>
          </form>
        </details>`
      : ''}
  </div>
</div>`;
}

export function checkPage({ csrf, result, error, thumb }) {
  return html`
${pageHead('Find copies', 'Found a poster in an online shop that looks like an artwork you know? Save the image and upload it here.')}
<div class="two-col">
  <div>
    ${errorBlock(error)}
    <form method="post" action="/check" enctype="multipart/form-data" class="form card-form">
      ${csrfField(csrf)}
      <label>Suspected copy <input type="file" name="image" accept="image/*" required></label>
      <button class="btn">Check image</button>
      <p class="small muted">The image is compared against every registered artwork and is not stored.</p>
    </form>
  </div>
  <div class="aside">
    <h3>Tips</h3>
    <ul class="small">
      <li>Use the largest product photo you can find on the listing.</li>
      <li>Mock-ups (a poster on a wall) work best when the artwork fills most of the photo.</li>
      <li>Artists can monitor whole shop pages automatically from their dashboard.</li>
    </ul>
  </div>
</div>
${result
  ? html`<section>
      <h2>Result</h2>
      ${result.matches.length
        ? html`<p>${result.matches.length} registered artwork${result.matches.length === 1 ? '' : 's'} match this image.
             Similarity is shown as differing bits out of 64: 0 is identical, under 10 is very likely the same work.</p>
           <div class="grid">${result.matches.map((m) => artCard(m, thumb(m.id), html`<span class="badge">distance ${m.distance}/64</span>`))}</div>`
        : html`<p class="empty">No registered artwork matches this image.</p>`}
    </section>`
  : ''}`;
}

export function verifyPage({ cfg, csrf, result, error, keyId }) {
  return html`
${pageHead('Verify a registration', 'Confirm that a file is the original of a registered artwork, or check a certificate.')}
<div class="two-col">
  <div>
    ${errorBlock(error)}
    <form method="post" action="/verify" enctype="multipart/form-data" class="form card-form">
      ${csrfField(csrf)}
      <label>Original file <input type="file" name="file" id="verify-file" required></label>
      <input type="hidden" name="sha256" id="verify-sha">
      <button class="btn">Verify</button>
      <p class="small muted" id="verify-note">If your browser supports it, the file is hashed locally and only its SHA-256
      fingerprint is sent. The file itself never leaves your computer.</p>
    </form>
  </div>
  <div class="aside">
    <h3>Verify independently</h3>
    <p class="small">Certificates are signed with Ed25519 key <code>${keyId}</code>.
    Download the <a href="/.well-known/signing-key.pem">public key</a> and verify a certificate's <code>payload</code> against
    its <code>signature</code> with any standard tool.</p>
    <p class="small">Blockchain proofs (.ots) can be verified with the open-source <code>ots verify</code> client or at opentimestamps.org.
    They do not depend on ${cfg.siteName} at all.</p>
  </div>
</div>
${result
  ? html`<section>
      <h2>Result</h2>
      <p class="small muted">SHA-256: <code class="hash">${result.sha}</code></p>
      ${result.matches.length
        ? result.matches.map(
            (a) => html`<div class="flash flash-ok">
              <strong>✓ This is the registered original of “${a.title}”</strong> by
              <a href="/artist/${a.handle}">${a.display_name}</a>, registered ${fmtDate(a.created_at)}.
              <a href="/a/${a.id}">View certificate →</a></div>`,
          )
        : html`<div class="flash flash-err">No registration exists for this exact file. Note that any change to a file,
            even re-saving it, changes its fingerprint.</div>`}
    </section>`
  : ''}`;
}

export function legalPage({ cfg, which }) {
  if (which === 'terms')
    return html`${pageHead('Terms of use')}
<div class="prose">
  <p>By creating an account you confirm that you are the author of, or hold the rights to, every work you register.
  Registering work you do not own is prohibited and leads to removal of the work and the account.</p>
  <p>You keep all rights to your work. You grant ${cfg.siteName} only the limited permission needed to store your files,
  display watermarked previews and compute fingerprints for matching. We will never sell, license or use your work to train AI models.</p>
  <p>Takedown notices generated by the service are drafts. You are responsible for reviewing them and for any notice you send.
  A notice contains legal statements made by you, and sending a notice in bad faith can have legal consequences.</p>
  <p>Monitoring only fetches publicly accessible pages, at a low rate. Do not add pages you are not entitled to access.</p>
  <p>The service is provided as is during the beta, without guarantee that every copy will be found or removed.</p>
</div>`;
  return html`${pageHead('Privacy')}
<div class="prose">
  <p>We store: your e-mail address, display name, profile details, the optional legal name and postal address used in
  takedown notices, the files you upload, the pages you monitor and the matches we find.</p>
  <p>Original files are stored privately and are never published. Only watermarked previews are shown publicly.
  Location and camera metadata are removed from previews.</p>
  <p>We use one session cookie and one security (CSRF) cookie. No tracking, no advertising, no third-party analytics.</p>
  <p>If you turn on web search for an artwork, a downscaled copy of it (max 1024 px) is sent to our reverse image search
  provider (Google Cloud Vision or TinEye), and to eBay's image search, each time it is searched. It is used only to find matching images.</p>
  <p>We count how many people view each artwork page (one view per visitor per day, without storing who they are) to notice when a work is trending.</p>
  <p>The SHA-256 fingerprint of each original is sent to public OpenTimestamps calendar servers. A fingerprint cannot be
  turned back into your image.</p>
  <p>You can delete individual artworks or your whole account at any time from your dashboard. Deletion removes the
  original, the preview and all related data.</p>
</div>`;
}

export function botPage({ cfg }) {
  return html`
${pageHead('ArtguardMonitor', `The crawler that checks shops for copies of artists' work registered on ${cfg.siteName}.`)}
<div class="prose">
  <p>If you see <code>ArtguardMonitor/1.0</code> in your logs: an artist registered on ${cfg.siteName} asked us to check a page on
  your site for unauthorised copies of their artwork.</p>
  <ul>
    <li>It only fetches pages an artist has added, plus the product images on those pages, and re-checks them at most once a day.</li>
    <li>It always identifies itself with this user agent and never disguises itself as a regular browser.</li>
    <li>If your site blocks it (with a 403, a captcha or a challenge page), it stops and tells the artist the page could not be checked. It does not try to get around blocks.</li>
    <li>Images are only compared against registered artworks. Nothing is republished, and nothing is used for AI training.</li>
  </ul>
  <p>If a listing on your site was flagged, the artist may contact you or the marketplace with a takedown notice.
  Questions about the crawler can be sent to the site operator.</p>
</div>`;
}
