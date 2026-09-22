// Kiosk-print helpers — Android thermische printer via RawBT app.
//
// RawBT (https://rawbt.ru) is een gratis Android-app die ESC/POS + JPG
// receipts kan uitprinten op vrijwel elke 80mm thermische printer
// (Bluetooth, USB, Wifi/LAN). De browser kan RawBT triggeren via een
// speciale `intent://` URL die Android automatisch naar de RawBT app
// stuurt. RawBT print daarna zonder tussenscherm — perfect voor kiosk.
//
// Op non-Android platforms (desktop Chrome, iPad) valt de helper terug
// op de standaard `iframe.contentWindow.print()` flow zodat Chrome's
// `--kiosk-printing` desktop-vlag de dialoog kan overslaan.

/** Detecteer Android via user-agent (case-insensitive). */
export function isAndroid() {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}

/**
 * Bouw een absolute URL naar de kwitantie-JPG. Wordt gebruikt in de
 * RawBT intent zodat de app het plaatje direct van onze backend kan
 * ophalen en printen.
 */
export function buildReceiptImageUrl(paymentId) {
  const base = process.env.REACT_APP_BACKEND_URL || window.location.origin;
  return `${base}/api/payments/${paymentId}/image`;
}

/**
 * Trigger RawBT via `intent://` scheme met `scheme=rawbt`.
 *
 * De browser stuurt de intent naar Android → Android routeert naar apps
 * die het `rawbt://` schema afhandelen (uitsluitend RawBT) → RawBT haalt
 * de JPG direct van onze backend en print zonder tussenscherm.
 *
 * Format details (per RawBT docs op rawbt.ru):
 *   scheme=rawbt        → routeert direct naar RawBT (geen "kies app" dialoog)
 *   package=...         → dwingt Android om exact deze app te openen
 *   S.browser_fallback_url = Play Store link zodat gebruiker de app kan installeren
 *   (GEEN action=VIEW + type=image/jpeg — dat opent een gallery-app i.p.v. RawBT)
 *
 * Retourneert `true` als de intent is gestart, `false` bij fout (bv. ongeldige URL).
 */
export function printViaRawBT(paymentId) {
  try {
    const jpgUrl = buildReceiptImageUrl(paymentId);
    const pkg = 'ru.a402d.rawbtprinter';
    const fallback = encodeURIComponent(`https://play.google.com/store/apps/details?id=${pkg}`);
    const intentUrl =
      `intent:${jpgUrl}#Intent;` +
      `scheme=rawbt;` +
      `package=${pkg};` +
      `S.browser_fallback_url=${fallback};` +
      `end`;
    // Gebruik `location.href` i.p.v. window.open zodat Android de intent
    // direct binnen dezelfde tab naar RawBT stuurt — geen popup-blockers.
    window.location.href = intentUrl;
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[kiosk-print] RawBT intent gefaald:', e);
    return false;
  }
}

/**
 * Fallback voor niet-Android telefoons (iOS/iPadOS) en Android-toestellen
 * zonder RawBT: open de JPG-kwitantie in een nieuw tabblad. De gebruiker
 * kan dan zelf "Delen" (Share sheet) → "Afdrukken" of "Opslaan in Foto's"
 * kiezen. Dit werkt op elke browser en op elk platform.
 *
 * Retourneert `true` als er iets is geopend, `false` bij popup-blocker.
 */
export function openReceiptImage(paymentId) {
  try {
    const jpgUrl = buildReceiptImageUrl(paymentId);
    const w = window.open(jpgUrl, '_blank', 'noopener,noreferrer');
    return !!w;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[kiosk-print] openReceiptImage gefaald:', e);
    return false;
  }
}
