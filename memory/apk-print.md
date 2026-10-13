# APK — PRINT_RECEIPT afhandelen (systeem-printvenster)

De web-app stuurt na een betaling (en bij "Print bon opnieuw"):
```json
{ "type": "PRINT_RECEIPT", "textZoom": 420, "lettergrootte": "groot", "fontSizes": {"tekst":20,"bedrijfsnaam":26,"kwitantie":22,"bedrag":28},
  "url": "https://<domein>/api/payments/<id>/print.html?format=thermal&preview=1",
  "data": { "bedrijfsnaam","adres","telefoon","kwitantie","datum","naam","appartement","vestiging","omschrijving","bedrag","openstaand","methode","opmerking" } }
```
`url` is een print-klare HTML-bon (58mm, @media print). De APK opent hiermee het Android-printvenster.

## React Native (Expo) voorbeeld
```js
import * as Print from 'expo-print';
import { WebView } from 'react-native-webview';

const onMessage = async (e) => {
  let msg; try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
  if (msg?.type !== 'PRINT_RECEIPT' || !msg.url) return;
  const html = await (await fetch(msg.url)).text();
  await Print.printAsync({ html });   // opent het systeem-printvenster, gebruiker kiest printer
};

<WebView source={{ uri: 'https://<domein>/kiosk' }} onMessage={onMessage} />
```
Zonder Expo: `react-native-print` → `RNPrint.print({ html })`.

## KingTop KT-V520 (KTPsdk.aar) — Instellingen → Kiosk apparaten
Staat de schakelaar aan, dan bevat PRINT_RECEIPT extra velden:
```json
{ "type": "PRINT_RECEIPT", "printer": "kt-v520",
  "lines": [ {"text":"SuriRent N.V.","align":"center","bold":true,"size":"large"},
             {"text":"BETAALD             SRD 4.000,00","align":"left","bold":true,"size":"normal"} ] }
```
- `lines` zijn al opgemaakt op 32 tekens (58mm, font A). APK: per regel uitlijning/vet/grootte zetten en tekst printen via KTPsdk, daarna papier doorvoeren + snijden.
- Zonder `printer` → huidige afhandeling (url → systeem-printvenster).
- Live: de kiosk-WebSocket (/api/kiosk/ws) stuurt `{"type":"device_config","printer":"kt-v520"|null}` bij verbinden en bij elke wijziging; de web-app bewaart dit in localStorage `kiosk_printer`.
