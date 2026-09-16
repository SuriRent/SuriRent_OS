# Kiosk Stille Afdruk — Setup Handleiding

## Probleem
Browsers tonen standaard **altijd** een printdialoog bij `window.print()` — dit is een security-restrictie waar geen omweg voor is via JavaScript alleen. Om echt stil te printen zonder dialoog moet de browser opgestart worden met een speciale vlag.

## Oplossing: Chrome/Edge Kiosk-Printing Mode

De Kiosk app print direct naar de **OS-standaardprinter** als de browser gestart is met de `--kiosk-printing` flag.

### 1. Zorg dat de printer werkt in het OS
- Verbind de printer (USB, netwerk of Bluetooth) met de tablet/PC.
- Ga naar Instellingen → Printers en scanners.
- Zet de gewenste printer als **standaardprinter**.
- Druk een testpagina af om te bevestigen dat het werkt.

### 2. Start Chrome met kiosk-printing

#### Windows (aanbevolen voor kiosk-tablets)
Maak een snelkoppeling met dit doel:
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing --app=https://JOUW-KIOSK-URL
```

Of voor Edge:
```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk --kiosk-printing --app=https://JOUW-KIOSK-URL
```

#### macOS
```
open -a "Google Chrome" --args --kiosk --kiosk-printing --app=https://JOUW-KIOSK-URL
```

#### Linux
```
google-chrome --kiosk --kiosk-printing --app=https://JOUW-KIOSK-URL
```

#### Android/iOS
Deze vlaggen bestaan **niet** op mobiele browsers. Op een iPad/Android tablet zal het printdialoog altijd verschijnen. Overweeg een Windows/Chromebox tablet voor kiosk-scenario's waar stille print gewenst is.

### 3. Test
- Open de Kiosk PWA.
- Selecteer een huurder → Betalingsgeschiedenis → klik "Afdruk".
- De bon moet direct uit de printer komen — er verschijnt géén dialoog.
- Onder de rij verschijnt kort een groen "Afgedrukt" bericht.

## Fout: "Geen printer beschikbaar" / "Afdruk mislukt"
Verschijnt als:
- Er geen standaardprinter is ingesteld in het OS.
- De printer offline is.
- De PDF niet opgehaald kon worden (netwerkfout).
- Chrome niet met `--kiosk-printing` is opgestart (in dat geval verschijnt gewoon het dialoog wat de gebruiker moet bevestigen).

## Fallback zonder `--kiosk-printing`
Als de kiosk toch draait zonder de flag, verschijnt gewoon het printdialoog. De operator kan dan met één klik op Enter/Print bevestigen.

## Referenties
- Chrome switches: <https://peter.sh/experiments/chromium-command-line-switches/#kiosk-printing>
- Chromium docs: `--kiosk-printing` skipt de print preview dialog wanneer `window.print()` wordt aangeroepen.
