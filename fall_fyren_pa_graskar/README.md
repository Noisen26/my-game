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
| `00_Las_forst.pdf` | Omslag, uppdragsbrev, regler, innehållsförteckning och svarsblad |
| `Akt/B01–B20` | Ett dokument per bevis |
| `Svarskontroll.pdf` | Svarskoder och ledtrådar |
| `Losning.pdf` | Lösning, motivöversikt, tidslinje och epilog |
| `Fyren_pa_Graskar_alla_dokument.pdf` | Alla dokument i en fil, för utskrift |

## Frågor och svar (spoiler)

Spelaren svarar på två frågor:

1. Vem är skyldig? **Jonas Ek** (kod 509)
2. Varför? **Henrik hade upptäckt förskingringen via falska fakturor** (kod 183)

Motiven i fallet: Maria (livförsäkringen), Lukas (skulder, ville sälja),
Anders (vindkraften) och Jonas (förskingringen). Sofia och Aisha har inget motiv.

All text finns i `bygg_fall.py`. Ändra där och bygg om.
