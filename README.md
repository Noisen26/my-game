# Konstskydd

En plattform där konstnärer kan visa sina verk utan att lämna ut en version som går att stjäla och trycka,
och med bevis i handen när någon ändå gör det.

## Ärligt om vad som går och inte går

Ingen tjänst kan göra en bild som visas på en skärm 100 % stöldsäker. Allt som syns kan fotas av eller
skärmdumpas. Strategin är därför att göra stöld **värdelös**, **svår** och **bevisbar**:

| Lager | Vad det gör | Implementerat |
|---|---|---|
| **Originalet lämnas aldrig ut** | Fullupplöst fil sparas privat och har ingen URL | ✅ |
| **Nedskalad förhandsvisning** | Max 1000 px och JPEG q78. Duger inte till att trycka en poster | ✅ |
| **Vattenstämpel över hela ytan** | Diagonal, upprepad text plus banderoll med namn och länk. Svår att beskära bort | ✅ |
| **Upphovsrätt i metadata** | EXIF `Artist`/`Copyright` med AI-förbud | ✅ |
| **Juridiskt AI-förbehåll** | `robots.txt`, `ai.txt`, `X-Robots-Tag: noai`, TDMRep (`tdm-reservation: 1`, `/.well-known/tdmrep.json`). Ett maskinläsbart förbehåll gör att undantaget för textutvinning (EU 2019/790 art. 4, 15 a § URL) **inte** gäller | ✅ |
| **Blockering av AI-crawlers** | ~27 kända bottar (GPTBot, CCBot, Bytespider …) får 403 | ✅ |
| **Anti-massnedladdning** | Bild-URL:er är HMAC-signerade och slutar gälla efter 10 min, hastighetsbegränsning per IP, skriptklienter blockeras, `Cross-Origin-Resource-Policy` stoppar hotlänkning | ✅ |
| **Registreringsbevis** | Tidsstämpel + SHA-256 av originalet. Konstnären kan visa att hen har filen som ger exakt den hashen | ✅ |
| **Hitta kopior** | Perceptuell hash (dHash). Ladda upp en bild från en webbutik och se om den matchar ett registrerat verk, även efter omskalning, komprimering och färgjustering | ✅ |

## Kom igång

```bash
npm install
npm start            # http://localhost:3000
npm test             # 7 integrationstester
```

Miljövariabler: `PORT`, `SITE_URL` (visas i vattenstämpeln, t.ex. `konstskydd.se`), `URL_SECRET`
(sätt den i produktion, annars slutar signerade länkar gälla vid omstart).

## Struktur

- `src/server.js`: Express-app med rutter för uppladdning, galleri, bild, kontroll och borttagning
- `src/imaging.js`: förhandsvisning, vattenstämpel, EXIF, SHA-256, dHash
- `src/antiscrape.js`: botlista, förbehållsheaders, hastighetsbegränsning, signerade URL:er
- `src/store.js`: JSON-fil + filsystem (originalen ligger utanför allt som serveras)
- `src/views.js`, `public/`: gränssnitt på svenska

## Nästa steg (förslag)

1. **Konton och inloggning** i stället för ägarnyckel, plus en riktig databas (Postgres/SQLite).
2. **Oberoende tidsstämpel**: förankra SHA-256 via [OpenTimestamps](https://opentimestamps.org) eller en
   RFC 3161-tjänst så att beviset inte vilar på vår egen databas.
3. **Osynlig vattenstämpel** som tål skärmdump och beskärning (t.ex. Adobe TrustMark eller
   `invisible-watermark`), så att ett verk-ID kan läsas ut ur en stulen bild.
4. **C2PA / Content Credentials**: signerat ursprungsintyg inbäddat i filen.
5. **Automatisk bevakning**: sök regelbundet i Etsy, Amazon, Redbubble, Temu m.fl. med omvänd bildsökning
   (t.ex. Google Lens/TinEye-API) och jämför mot registrerade hashar, och notifiera konstnären.
6. **Färdiga DMCA- och anmälningsmallar** förifyllda med registreringsbeviset.
7. **Valfritt adversariellt skydd** (Glaze/Nightshade-liknande) för att störa AI-stilkopiering.
8. Ett mer beskärningståligt matchningsfingeravtryck (t.ex. pHash på flera utsnitt, eller bild-embeddings).
