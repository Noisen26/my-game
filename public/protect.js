// En liten tröskel för vanliga besökare, inget riktigt skydd. Det riktiga
// skyddet är att bara en nedskalad, vattenstämplad version finns att hämta.
document.addEventListener('contextmenu', (e) => {
  if (e.target instanceof HTMLImageElement) e.preventDefault();
});
document.addEventListener('dragstart', (e) => {
  if (e.target instanceof HTMLImageElement) e.preventDefault();
});
