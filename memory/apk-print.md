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
