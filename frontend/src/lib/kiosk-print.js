// Kiosk-print helpers — window.print() met de bon in #bon (zie index.css
// @media print). Fallback openReceiptImage() opent de JPG-versie.

export function buildReceiptImageUrl(paymentId) {
  const base = process.env.REACT_APP_BACKEND_URL || window.location.origin;
  return `${base}/api/payments/${paymentId}/image`;
}

// Exacte paginahoogte: "size: 58mm auto" negeert Chrome (valt terug op A4),
// daarom meten we #bon en zetten we een @page met vaste hoogte.
function fitPageToBon(bon) {
  const prev = bon.style.cssText;
  bon.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;width:54mm;font-size:13px;';
  const hmm = Math.max(40, Math.ceil(bon.offsetHeight * 25.4 / 96) + 4);
  bon.style.cssText = prev;
  let el = document.getElementById('bon-page-size');
  if (!el) { el = document.createElement('style'); el.id = 'bon-page-size'; document.head.appendChild(el); }
  el.textContent = `@media print { @page { size: 58mm ${hmm}mm; margin: 0; } }`;
}

/**
 * Print de bon via window.print(): de bon staat in #bon en de @media print
 * CSS (index.css) verbergt al het andere. In de APK opent de app zelf het
 * systeem-printvenster via PRINT_RECEIPT.
 */
export async function printReceipt({ paymentId, apiGet }) {
  if (window.ReactNativeWebView?.postMessage) {
    const base = process.env.REACT_APP_BACKEND_URL || window.location.origin;
    let data = { payment_id: paymentId };
    try { data = { ...data, ...((await apiGet(`/kiosk/payments/${paymentId}/print-data`)).data || {}) }; } catch { /* alleen url */ }
    const msg = { type: 'PRINT_RECEIPT', url: `${base}/api/payments/${paymentId}/print.html?format=thermal&preview=1`, textZoom: data.textZoom ?? 280, lettergrootte: data.lettergrootte || 'groot', data };
    // eslint-disable-next-line no-console
    console.log('[APK PRINT_RECEIPT]', msg);
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    return true;
  }
  try {
    const resp = await apiGet(`/payments/${paymentId}/print.html?fragment=1`, { responseType: 'text' });
    if (!resp?.data) return false;
    let bon = document.getElementById('bon');
    if (!bon) { bon = document.createElement('div'); bon.id = 'bon'; document.body.appendChild(bon); }
    bon.innerHTML = String(resp.data).replace(/<script[\s\S]*?<\/script>/gi, '');
    fitPageToBon(bon);
    window.print();
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
