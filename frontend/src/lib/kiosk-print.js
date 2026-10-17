import { getSavedPrinter, paperWidth, printLinesBluetooth, printerMode } from './bt-printer';

// Kiosk-print helpers — window.print() met de bon in #bon (zie index.css
// @media print). Fallback openReceiptImage() opent de JPG-versie.

export function buildReceiptImageUrl(paymentId) {
  const base = process.env.REACT_APP_BACKEND_URL || window.location.origin;
  return `${base}/api/payments/${paymentId}/image`;
}

// Exacte paginahoogte: "size: 58mm auto" negeert Chrome (valt terug op A4),
// daarom meten we #bon en zetten we een @page met vaste hoogte.
function fitPageToBon(bon) {
  // Meet met de print-lettergroottes (html.fitm, zie backend comp_css) zodat
  // de pagina direct na de laatste regel eindigt — geen witruimte onderaan.
  const prev = bon.style.cssText;
  bon.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;width:54mm;';
  document.documentElement.classList.add('fitm');
  const sheet = bon.querySelector('.sheet') || bon;
  const hmm = Math.max(20, Math.ceil(sheet.getBoundingClientRect().height * 25.4 / 96) + 1);
  document.documentElement.classList.remove('fitm');
  bon.style.cssText = prev;
  let el = document.getElementById('bon-page-size');
  if (!el) { el = document.createElement('style'); el.id = 'bon-page-size'; document.head.appendChild(el); }
  el.textContent = `@media print { @page { size: 58mm ${hmm}mm; margin: 0; } html, body { height: ${hmm}mm !important; min-height: 0 !important; overflow: hidden !important; } }`;
}

// APK-brug: React Native WebView óf gewone Android-WebView (addJavascriptInterface "Android").
export function apkBridge() {
  if (typeof window === 'undefined') return null;
  if (window.ReactNativeWebView?.postMessage) return (str) => window.ReactNativeWebView.postMessage(str);
  if (typeof window.Android?.print === 'function') return (str) => window.Android.print(str);
  if (typeof window.Android?.postMessage === 'function') return (str) => window.Android.postMessage(str);
  return null;
}

// PRINT_RECEIPT voor de APK. printer 'kt-v520' → APK print `lines` via KTPsdk.
export function apkPrintMessage(url, data) {
  const printer = data.printer !== undefined ? data.printer : localStorage.getItem('kiosk_printer');
  const msg = { type: 'PRINT_RECEIPT', url, textZoom: data.textZoom ?? 420, lettergrootte: data.lettergrootte || 'groot', fontSizes: data.fontSizes, data };
  if (printer === 'kt-v520' && data.lines) { msg.printer = 'kt-v520'; msg.lines = data.lines; }
  const bt = getSavedPrinter();
  if (printer === 'bluetooth' && data.lines && bt?.via === 'apk') {
    Object.assign(msg, { printer: 'bluetooth', bt_address: bt.id, paper_width: data.paper_width || paperWidth(), lines: data.lines });
  }
  return msg;
}

/**
 * Print de bon via window.print(): de bon staat in #bon en de @media print
 * CSS (index.css) verbergt al het andere. In de APK opent de app zelf het
 * systeem-printvenster via PRINT_RECEIPT.
 */
export async function printReceipt({ paymentId, apiGet, relay = true }) {
  // Meld de print aan het kiosk live-kanaal (beheerder-kiosk drukt mee af).
  if (relay) window.dispatchEvent(new CustomEvent('kiosk-receipt-printed', { detail: { paymentId } }));
  const bridge = apkBridge();
  if (bridge) {
    const base = process.env.REACT_APP_BACKEND_URL || window.location.origin;
    let data = { payment_id: paymentId };
    try { data = { ...data, ...((await apiGet(`/kiosk/payments/${paymentId}/print-data`)).data || {}) }; } catch { /* alleen url */ }
    const msg = apkPrintMessage(`${base}/api/payments/${paymentId}/print.html?format=thermal&preview=1`, data);
    // eslint-disable-next-line no-console
    console.log('[APK PRINT_RECEIPT]', msg);
    bridge(JSON.stringify(msg));
    return true;
  }
  // Bluetooth bonprinter (Chrome/Edge); lukt dat niet → gewoon printvenster.
  if (printerMode() === 'bluetooth' && getSavedPrinter()?.via === 'web') {
    try {
      const { data } = await apiGet(`/kiosk/payments/${paymentId}/print-data`);
      if (data?.lines) { await printLinesBluetooth(data.lines); return true; }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[kiosk-print] Bluetooth print mislukt, val terug op printvenster:', e);
      window.dispatchEvent(new CustomEvent('bt-print-error', { detail: { message: e?.message || String(e) } }));
    }
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
 * Financieel overzicht als bon: APK (PRINT_RECEIPT met regels) of
 * printvenster met de 58mm PNG.
 */
export async function printFinancialReceipt({ tenantId, apiGet }) {
  const base = process.env.REACT_APP_BACKEND_URL || window.location.origin;
  const bridge = apkBridge();
  if (bridge) {
    let data = { tenant_id: tenantId };
    try { data = { ...data, ...((await apiGet(`/kiosk/tenants/${tenantId}/financial-print-data`)).data || {}) }; } catch { /* alleen url */ }
    bridge(JSON.stringify(apkPrintMessage(`${base}/api/kiosk/tenants/${tenantId}/financial-receipt.png`, data)));
    return true;
  }
  try {
    const { data } = await apiGet(`/kiosk/tenants/${tenantId}/financial-receipt.png`, { responseType: 'blob' });
    const src = URL.createObjectURL(data);
    let bon = document.getElementById('bon');
    if (!bon) { bon = document.createElement('div'); bon.id = 'bon'; document.body.appendChild(bon); }
    bon.innerHTML = `<div class="sheet"><img src="${src}" style="width:54mm;display:block" alt="bon"/></div>`;
    await new Promise((res) => { const img = bon.querySelector('img'); img.onload = res; img.onerror = res; });
    fitPageToBon(bon);
    window.print();
    setTimeout(() => URL.revokeObjectURL(src), 60000);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[kiosk-print] printFinancialReceipt gefaald:', e);
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
