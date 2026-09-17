# Kiosk Stille Afdruk — Setup Handleiding

## Probleem
Browsers tonen standaard **altijd** een printdialoog bij `window.print()` — dit is een security-restrictie waar geen omweg voor is via JavaScript alleen. Om echt stil te printen zonder dialoog moet de browser opgestart worden met een speciale vlag.

**Belangrijk**: dit werkt alleen op desktop OS'en (Windows/macOS/Linux). Op iPad/Android tablets is er GEEN manier om het printdialoog over te slaan — dat is een beperking van mobiele browsers.

## Windows — Exacte stappen

### Stap 1 — Sluit alle Chrome vensters
1. Rechter-muisklik op de Chrome-icoon in de taakbalk → **Alle vensters sluiten**
2. Wacht 5 seconden zodat Chrome volledig is afgesloten

### Stap 2 — Maak een snelkoppeling
1. Rechter-muisklik op je bureaublad → **Nieuw** → **Snelkoppeling**
2. Vul bij "Locatie van item" één van deze regels in:

**Chrome (aanbevolen)**:
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing --app=https://JOUW-KIOSK-URL
```

**Edge**:
```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk --kiosk-printing --app=https://JOUW-KIOSK-URL
```

Vervang `JOUW-KIOSK-URL` door je eigen preview-URL, bijvoorbeeld
`https://vastgoed-app.preview.emergentagent.com/vastgoed/kiosk`.

3. Klik **Volgende**, geef de snelkoppeling een naam (bv. "Kiosk"), klik **Voltooien**

### Stap 3 — Stel je printer in als standaard
1. Windows Start → **Instellingen** → **Bluetooth en apparaten** → **Printers en scanners**
2. Klik op je printer → **Als standaard instellen**
3. Druk een testpagina af om te bevestigen dat het werkt

### Stap 4 — Test
1. Dubbelklik op de nieuwe "Kiosk" snelkoppeling
2. Chrome opent in full-screen kiosk-modus
3. Log in met je PIN en voer een testbetaling uit
4. De bon moet **direct** uit de printer komen — **geen dialoog!**
5. Onder de rij verschijnt kort een groen "Afgedrukt" bericht

### Uit kiosk-modus komen
Druk op **Alt+F4** of **Ctrl+W** om de kiosk-modus te sluiten.

## macOS
```
open -a "Google Chrome" --args --kiosk --kiosk-printing --app=https://JOUW-KIOSK-URL
```

## Linux
```
google-chrome --kiosk --kiosk-printing --app=https://JOUW-KIOSK-URL
```

## Android/iOS
Deze vlaggen bestaan **niet** op mobiele browsers. Op een iPad/Android tablet zal het printdialoog altijd verschijnen. Overweeg een Windows/Chromebox tablet voor kiosk-scenario's waar stille print gewenst is.

## Kwitantie afdrukformaat — A4 of 80mm bonrol
In het beheer via **Instellingen → Kwitantie afdrukformaat**:
- **A4 kantoorprinter**: normale laser/inkjet printers op een PC
- **80mm bonprinter (thermisch)**: POS-stijl bon voor 80mm thermische bonprinters

Deze keuze bepaalt de HTML-render van de kwitantie. De medewerker hoeft niets te doen — de Kiosk-print gebruikt automatisch het gekozen formaat.

## Fout: "Geen printer beschikbaar" / "Afdruk mislukt"
Verschijnt als:
- Er geen standaardprinter is ingesteld in het OS
- De printer offline is
- De PDF/HTML niet opgehaald kon worden (netwerkfout)
- Chrome niet met `--kiosk-printing` is opgestart (in dat geval verschijnt gewoon het dialoog wat de gebruiker moet bevestigen)

## Fallback zonder `--kiosk-printing`
Als de kiosk toch draait zonder de flag, verschijnt gewoon het printdialoog. De operator kan dan met één klik op Enter/Print bevestigen.

## Referenties
- Chrome switches: <https://peter.sh/experiments/chromium-command-line-switches/#kiosk-printing>
- Chromium docs: `--kiosk-printing` skipt de print preview dialog wanneer `window.print()` wordt aangeroepen.
