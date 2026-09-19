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
 * Trigger RawBT via `intent://` scheme. De browser stuurt de intent
 * naar Android → Android opent RawBT (of Play Store als de app nog
 * niet is geïnstalleerd) → RawBT haalt de JPG op en print op de
 * gekoppelde thermische printer.
 *
 * Format details:
 *   scheme=rawbt        → open RawBT app
 *   action=VIEW         → toon/print de URL
 *   type=image/jpeg     → hint dat het een JPG is (RawBT verwerkt dan als plaatje-print)
 *   S.browser_fallback_url = Play Store link zodat gebruiker de app kan installeren
 */
export function printViaRawBT(paymentId) {
  const jpgUrl = buildReceiptImageUrl(paymentId);
  const pkg = 'ru.a402d.rawbtprinter';
  const fallback = encodeURIComponent(`https://play.google.com/store/apps/details?id=${pkg}`);
  const intentUrl =
    `intent:${jpgUrl}#Intent;` +
    `action=android.intent.action.VIEW;` +
    `type=image/jpeg;` +
    `package=${pkg};` +
    `S.browser_fallback_url=${fallback};` +
    `end`;
  // Gebruik `location.href` i.p.v. window.open zodat Android de intent
  // direct binnen dezelfde tab naar RawBT stuurt — geen popup-blockers.
  window.location.href = intentUrl;
}
