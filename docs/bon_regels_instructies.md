# Bonregels — instructies voor printers (KT-V520 / Bluetooth)

Elk printbericht (`PRINT_RECEIPT` lokaal via de APK-brug, `REMOTE_PRINT` via WebSocket) bevat:

- `lines`: kant-en-klare bonregels `{text, align: "left"|"center", bold, size: "normal"|"large"}`, 32 tekens per regel (58mm) of 48 (80mm). Print deze 1-op-1.
- `template: "lines"` (kasbon, financieel overzicht): print uitsluitend `lines`, niet het betalingssjabloon.
- Betalingsvelden (betalingsbon): `bedrijfsnaam`, `adres`, `telefoon`, `kwitantie`, `datum`, `naam`, `huurder_telefoon`, `medewerker`, `appartement`, `vestiging`, `omschrijving`, `bedrag`, `openstaand`, `outstanding_after`, `methode`, `opmerking`.

## Optioneel veld `openstaand_periode`

- Type: tekst, bv. `"Aug, Sep 2026"` of `"Dec 2026, Jan 2027"`.
- Wordt alleen meegestuurd als er na de betaling nog een bedrag openstaat (`outstanding_after > 0`) én er openstaande maanden bekend zijn.
- **Aanwezig** → onder het bedrag (regel `BETAALD`) komt in plaats van de regel `Openstaand: SRD …`:

```
Nog openstaand:          (vet)
SRD 3.000,00             (vet)
Maand(en): Aug, Sep 2026
```

  Langere periodes lopen door op de volgende regel (max. 32 tekens per regel).
- **Afwezig** → de bon blijft ongewijzigd (regel `Openstaand: SRD 0,00`).

In `lines` is dit blok al verwerkt. Een APK die een eigen sjabloon gebruikt, moet `openstaand_periode` zelf op dezelfde manier tonen.
