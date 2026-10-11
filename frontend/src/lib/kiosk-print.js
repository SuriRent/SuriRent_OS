// Kiosk-print helpers — universeel via `iframe.contentWindow.print()`.
//
// Design (na verwijderen van RawBT-intent 2026-02-22):
//   • Backend levert de bon als HTML op `/api/payments/{id}/print.html`
//     met `format=thermal` (80mm) en `preview=1` (geen inline auto-print).
//   • Frontend maakt een onzichtbare `iframe` aan met `srcdoc=<html>`,
//     wacht op `onload` en roept `contentWindow.print()` aan.
//   • Op desktop Chrome met `--kiosk-printing` slaat het OS-dialoog over
//     en print direct.
//   • Op Android Chrome + iOS Safari verschijnt het native print-dialoog
//     waar de gebruiker een printer kiest (Cloud Print, AirPrint, opslaan
//     als PDF, delen naar Bluetooth-printer app, etc.). Dit werkt overal
//     — er is GEEN 3rd-party app zoals RawBT meer nodig.
//
// Ondersteunt ook een fallback `openReceiptImage()` die de JPG-versie in
// een nieuw tabblad opent — handig voor delen via WhatsApp of opslaan in
// Foto's op iOS.

export function buildReceiptImageUrl(paymentId) {
  const base = process.env.REACT_APP_BACKEND_URL || window.location.origin;
  return `${base}/api/payments/${paymentId}/image`;
}

/**
 * Print de bon universeel via een onzichtbare iframe. Werkt op:
 *   • Desktop Chrome (met --kiosk-printing → geen dialoog)
 *   • Android Chrome (native print-dialoog → kies printer of PDF)
 *   • iOS Safari (AirPrint dialoog)
 *
 * @param {object} opts
 * @param {string} opts.paymentId  — het payment ID
 * @param {(url: string, opts?: object) => Promise<{data: string}>} opts.apiGet
 *        — de axios-achtige `api.get` functie (fetch HTML met auth cookies).
 * @param {string} [opts.iframeId] — DOM id voor de iframe (uniek per aanroep-context).
 * @returns {Promise<boolean>} true bij succes, false bij fout.
 */
export async function printReceipt({ paymentId, apiGet, iframeId = 'kiosk-print-iframe' }) {
  // In de APK: laat de app het systeem-printvenster openen.
  if (window.ReactNativeWebView?.postMessage) {
    const base = process.env.REACT_APP_BACKEND_URL || window.location.origin;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'PRINT_RECEIPT', url: `${base}/api/payments/${paymentId}/print.html?format=thermal&preview=1`, data: { payment_id: paymentId },
    }));
    return true;
  }
  try {
    const resp = await apiGet(`/payments/${paymentId}/print.html?format=thermal&preview=1`, { responseType: 'text' });
    const html = resp?.data;
    if (!html) return false;
    const existing = document.getElementById(iframeId);
    if (existing) existing.remove();
    const iframe = document.createElement('iframe');
    iframe.id = iframeId;
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.srcdoc = html;
    await new Promise((resolve) => {
      iframe.onload = () => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[kiosk-print] iframe.print() gefaald:', err);
        }
        // Kleine buffer zodat de print-job async gestart is voordat we
        // resolven — voorkomt race tussen iframe.remove() en de dialoog.
        setTimeout(resolve, 300);
      };
      iframe.onerror = () => resolve();
      document.body.appendChild(iframe);
    });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[kiosk-print] printReceipt gefaald:', e);
    return false;
  }
}

/**
 * Fallback: open de JPG-kwitantie in een nieuw tabblad. Handig voor:
 *   • Delen via WhatsApp / iMessage
 *   • Opslaan in Foto's op iOS
 *   • Wanneer print-dialoog geblokkeerd wordt
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
