# Fyren på Gråskär

Ett nytt, helt fiktivt fall för Skuggarkivet. Spelaren utreder ett avskrivet
dödsfall i Roslagens skärgård 2019 med hjälp av polisrapporter, förhör, karta,
obduktionsprotokoll, telefonlistor och tidningsklipp.

## Bygga PDF-filerna

```bash
pip install reportlab pypdf      # pypdf behövs bara för samlingsfilen
python3 bygg_fall.py             # skriver till ./utdata
```

## Svårighetsgrad: svår

Akten innehåller bara rådata, inga slutsatser och inga markeringar. Varje
avgörande ledtråd kräver att spelaren kombinerar två till fyra dokument.
Fem misstänkta, alla med ett verkligt motiv. Varje förhör från 2019 följs av ett
nytt samtal från 2026, där personerna lägger till, ändrar eller motsäger det de
sa tidigare.
Svarskontrollen ger bara ett kontrollord, ingen ledning vid fel svar.

## Innehåll i `utdata/`

| Fil | Innehåll |
|---|---|
| `00_Las_forst.pdf` | Omslag, uppdragsbrev, regler, innehållsförteckning och svarsblad |
| `Akt/B01–B21` | Ett dokument per bevis |
| `Svarskontroll.pdf` | 25 svarskoder med kontrollord |
| `Ledtradar.pdf` | Stegvisa ledtrådar, från vaga till tydliga |
| `Losning.pdf` | Rätt kontrollord på omslaget, sedan beviskedja, motiv, tidslinje och epilog |
| `Fyren_pa_Graskar_alla_dokument.pdf` | Alla dokument i en fil, för utskrift |

## Svar (spoiler)

Jonas Ek, som dödade Henrik för att dölja en förskingring.
Svarskod 5879, kontrollord STORMFÅGEL.

All text finns i `bygg_fall.py`. Ändra där och bygg om. Skriptet skriver ut
rätt svarskod och kontrollord efter varje bygge.
