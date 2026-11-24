export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtDate = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

export const layout = (title, body) => `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noai, noimageai">
<title>${esc(title)} · Konstskydd</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header>
  <a class="brand" href="/">Konstskydd</a>
  <nav><a href="/">Galleri</a><a href="/upload">Ladda upp</a><a href="/check">Hitta kopior</a></nav>
</header>
<main>${body}</main>
<footer>Alla verk tillhör respektive konstnär. Text- och datautvinning samt AI-träning är uttryckligen förbjuden
(förbehåll enligt EU-direktiv 2019/790 art. 4.3 och 15 a § upphovsrättslagen).</footer>
<script src="/static/protect.js"></script>
</body>
</html>`;

const card = (a) => `<a class="card" href="/a/${esc(a.id)}">
  <img src="${esc(a.src)}" alt="${esc(a.title)} av ${esc(a.artist)}" loading="lazy" draggable="false">
  <span><strong>${esc(a.title)}</strong><br>${esc(a.artist)}</span>
</a>`;

export const galleryPage = (items) => `
<h1>Galleri</h1>
${items.length ? `<div class="grid">${items.map(card).join('')}</div>` : '<p>Inga verk ännu. <a href="/upload">Ladda upp det första!</a></p>'}`;

export const uploadPage = (error) => `
<h1>Ladda upp ett verk</h1>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/upload" enctype="multipart/form-data" class="form">
  <label>Konstnärsnamn <input name="artist" required maxlength="80"></label>
  <label>Verkets titel <input name="title" required maxlength="120"></label>
  <label>Bildfil (JPEG, PNG, WebP, TIFF, max 40 MB) <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/tiff" required></label>
  <button>Ladda upp och skydda</button>
</form>
<div class="info">
  <h2>Det här händer med din bild</h2>
  <ul>
    <li><strong>Originalet visas aldrig.</strong> Det sparas privat och kan inte nås via någon URL.</li>
    <li>Publikt visas bara en <strong>nedskalad version (max 1000 px)</strong> med vattenstämpel över hela ytan. Den duger inte att trycka en poster av.</li>
    <li>Ditt namn, upphovsrätt och ett AI-förbud skrivs in i bildens metadata.</li>
    <li>Du får ett <strong>registreringsbevis</strong> med tidsstämpel och fingeravtryck (SHA-256) av originalet.</li>
    <li>Ett perceptuellt fingeravtryck gör att du senare kan <a href="/check">ladda upp en misstänkt kopia</a> och se om den matchar.</li>
  </ul>
</div>`;

export const artworkPage = (a, ownerKey, siteUrl) => `
${ownerKey ? `<div class="notice">
  <strong>Verket är registrerat.</strong> Spara din ägarnyckel. Den visas bara den här gången och behövs för att ta bort verket:
  <code>${esc(ownerKey)}</code>
</div>` : ''}
<div class="artwork">
  <img src="${esc(a.src)}" alt="${esc(a.title)} av ${esc(a.artist)}" draggable="false">
  <div>
    <h1>${esc(a.title)}</h1>
    <p class="by">av ${esc(a.artist)}</p>
    <section class="cert">
      <h2>Registreringsbevis</h2>
      <dl>
        <dt>Verk-ID</dt><dd>${esc(a.id)}</dd>
        <dt>Registrerat</dt><dd>${esc(fmtDate(a.createdAt))}</dd>
        <dt>Originalets storlek</dt><dd>${a.width} × ${a.height} px (${esc(a.format)})</dd>
        <dt>SHA-256 (original)</dt><dd><code>${esc(a.sha256)}</code></dd>
        <dt>Perceptuell hash</dt><dd><code>${esc(a.dhash)}</code></dd>
        <dt>Permanent länk</dt><dd>${esc(siteUrl)}/a/${esc(a.id)}</dd>
      </dl>
      <p class="small">SHA-256 visar att exakt den här originalfilen fanns hos oss vid tidpunkten ovan. Bara du har originalfilen,
      så du kan visa att den ger samma hash. Det är ett starkt bevis på att du är upphovsperson.</p>
    </section>
    <details>
      <summary>Ta bort verket</summary>
      <form method="post" action="/a/${esc(a.id)}/delete" class="form">
        <label>Ägarnyckel <input name="key" required></label>
        <button class="danger">Ta bort permanent</button>
      </form>
    </details>
  </div>
</div>`;

export const checkPage = (result, error) => `
<h1>Hitta kopior av ditt verk</h1>
<p>Har du hittat din poster i en webbutik? Spara bilden därifrån och ladda upp den här. Vi jämför den mot alla registrerade verk,
även om den är omskalad, komprimerad eller färgjusterad.</p>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/check" enctype="multipart/form-data" class="form">
  <label>Misstänkt kopia <input type="file" name="image" accept="image/*" required></label>
  <button>Kontrollera</button>
</form>
${result ? `<h2>Resultat</h2>
${result.matches.length
  ? `<p>${result.matches.length} möjlig(a) träff(ar). Lägre avstånd betyder större likhet (0 = identisk).</p>
     <div class="grid">${result.matches.map((m) => card(m).replace('</span>', `<br><em>avstånd ${m.distance}/64</em></span>`)).join('')}</div>
     <p class="small">Matchar det ditt verk? Använd registreringsbeviset när du anmäler intrånget till butiken eller plattformen
     (t.ex. via Etsys, Amazons eller Shopifys formulär för upphovsrättsintrång).</p>`
  : '<p>Ingen matchning bland registrerade verk.</p>'}` : ''}`;
