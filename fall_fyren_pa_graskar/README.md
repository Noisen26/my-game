# Fyren på Gråskär

Ett nytt, helt fiktivt fall för Skuggarkivet. Spelaren utreder ett avskrivet
dödsfall i Roslagens skärgård 2019 med hjälp av polisrapporter, förhör, karta,
obduktionsprotokoll, telefonlistor och tidningsklipp.

## Bygga PDF-filerna

```bash
pip install reportlab pypdf      # pypdf behövs bara för samlingsfilen
python3 bygg_fall.py             # skriver till ./utdata
```

## Innehåll i `utdata/`

| Fil | Innehåll |
|---|---|
| `00_Las_forst.pdf` | Omslag, uppdragsbrev, regler, innehållsförteckning och uppdrag 1 |
| `Grundakt/B01–B17` | Ett dokument per bevis |
| `Kuvert_A.pdf` | Analysrapport 2026 (B18) och uppdrag 2. Öppnas efter uppdrag 1. |
| `Kuvert_B.pdf` | Fakturor, lönespecifikation, nytt förhör (B19–B21) och uppdrag 3 |
| `Kuvert_C_Losning.pdf` | Lösning med fullständig tidslinje |
| `Svarskontroll.pdf` | Svarskoder och tre ledtrådar per uppdrag |
| `Fyren_pa_Graskar_alla_dokument.pdf` | Alla dokument i en fil, för utskrift |

## Uppdrag och svar (spoiler)

1. Var dog Henrik? **Båthuset** (kod 238)
2. Vem bar den gula regnrocken kl. 23.40? **Jonas Ek** (kod 509)
3. Varför? **Förskingring via falska fakturor** (kod 183)

All text finns i `bygg_fall.py`. Ändra där och bygg om.
