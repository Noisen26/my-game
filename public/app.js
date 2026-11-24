// Progressive enhancement only: every page works without JavaScript.
(() => {
  // Confirmation before destructive actions
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute?.('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Copy notice text
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('[data-copy]');
    if (!btn) return;
    const el = document.querySelector(btn.getAttribute('data-copy'));
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.value ?? el.textContent);
      const old = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => (btn.textContent = old), 1800);
    } catch {
      el.select?.();
    }
  });

  // A small speed bump for casual saving. The real protection is server-side:
  // only a small, watermarked preview is ever available.
  const isImg = (t) => t instanceof HTMLImageElement;
  document.addEventListener('contextmenu', (e) => isImg(e.target) && e.preventDefault());
  document.addEventListener('dragstart', (e) => isImg(e.target) && e.preventDefault());

  // Verify page: hash the file locally so it never leaves the device.
  const file = document.getElementById('verify-file');
  const sha = document.getElementById('verify-sha');
  if (file && sha && window.crypto?.subtle) {
    file.form.addEventListener('submit', async (e) => {
      if (sha.value || !file.files[0]) return;
      e.preventDefault();
      const btn = file.form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Hashing locally…';
      const digest = await crypto.subtle.digest('SHA-256', await file.files[0].arrayBuffer());
      sha.value = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      file.disabled = true; // do not upload the file itself
      file.form.submit();
    });
  }
})();
