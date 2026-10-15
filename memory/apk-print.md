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

## KT-V520 printer-modus (op afstand printen vanuit "Bonnen van vandaag")
1. APK zet vóór het laden van de pagina: `window.__SURIRENT_KTP__ = true;` (injectedJavaScriptBeforeContentLoaded).
2. De web-app koppelt het toestel automatisch zodra er één keer iemand op de kiosk inlogt (POST /api/kiosk/printers/register → localStorage `ktp_device_token`, blijft bewaard na uitloggen).
3. Daarna houdt de web-app zelf een WebSocket open (role "printer"), ook op het loginscherm. Bij een opdracht van de beheerder stuurt de web-app naar de APK:
   `{ type:"PRINT_RECEIPT", printer:"kt-v520", lines:[...], remote:true, job_id:"..." }` → APK print `lines` direct via KTPsdk, zonder dialoog.
4. Beheer: Instellingen → Kiosk apparaten → Gekoppelde KT-V520 toestellen (hernoemen / ontkoppelen).

## Herkenning & diagnose (update)
- KT-V520 wordt herkend als: APK-brug aanwezig (window.ReactNativeWebView.postMessage, of window.Android.print / window.Android.postMessage) EN (window.__SURIRENT_KTP__ === true OF user-agent bevat KT-V520/KTV520/KingTop OF al gekoppeld).
- Handmatig: knop "Koppel dit toestel als KT-V520" linksboven op de beheerder-kiosk (alleen zichtbaar met APK-brug).
- Diagnose: Instellingen → Kiosk apparaten → "Kiosk-toestellen (diagnose)" toont user-agent + vlaggen per toestel.
- Gewone Android-WebView: implementeer `@JavascriptInterface fun print(json: String)` op object "Android" — ontvangt hetzelfde PRINT_RECEIPT JSON.

## Bluetooth thermische printer (Instellingen → Bon printer)
- Bedrijfsstandaard `kiosk_devices.printer_mode` = none | kt-v520 | bluetooth, `paper_width` 58|80. WS device_config: `{printer, printer_mode, paper_width}` → localStorage `kiosk_printer`, `kiosk_paper_width`.
- Per toestel gekoppelde printer: localStorage `bt_printer` = {id, name, via:'web'|'apk'}.
- Browser (Chrome/Edge Android/Windows): Web Bluetooth BLE, ESC/POS in bt-printer.js. iOS: geen Bluetooth → window.print (AirPrint).
- APK moet implementeren:
  - `{type:"BT_SCAN"}` → zoek printers, antwoord: `window.dispatchEvent(new CustomEvent('apk-bt-devices',{detail:{devices:[{name,address}]}}))` (via injectJavaScript).
  - `{type:"BT_SELECT", address, name}` → bewaar printer.
  - `{type:"PRINT_RECEIPT", printer:"bluetooth", bt_address, paper_width, lines:[...]}` → ESC/POS naar die printer (classic SPP of BLE). Lines al opgemaakt op 32 (58mm) / 48 (80mm) tekens.

## FCM pushmeldingen (Instellingen → Notificaties → Android App Meldingen)
- Firebase project `surirent-b7379`; backend: fcm_service.py (HTTP v1), env FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_B64.
- APK moet: google-services.json (zelfde project), firebase-messaging, POST_NOTIFICATIONS (Android 13+), kanaal `surirent_default`.
- Token naar web-app: op `{type:"FCM_GET_TOKEN"}` (en bij onNewToken) injecteren:
  `window.dispatchEvent(new CustomEvent('apk-fcm-token',{detail:{token:'...',device_name:'Samsung A15'}}))`
  of vóór laden `window.__SURIRENT_FCM_TOKEN__ = '...'`. Web-app registreert dan POST /api/push/fcm/register (ingelogde beheerder).
- Data in melding: kind, url (+ ids) als strings → bij tik in de WebView naar `url` navigeren.
