// NFC tag-ID's uit de Android-app (APK) en andere bronnen naar de kiosk.
// APK: window.onNfcTag('04A1B2C3'), window event 'apk-nfc-tag' {detail:{id}},
// of postMessage {type:'NFC_TAG'|'NFC'|'NFC_SCAN', id|tag|uid|card_id}.
const subs = [];
let installed = false;

export const normalizeNfc = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Laatste abonnee krijgt de scan (bijv. open koppelscherm gaat vóór de kiosk-lijst).
export function emitNfc(raw) {
  const uid = normalizeNfc(typeof raw === 'object' && raw ? (raw.id || raw.tag || raw.uid || raw.card_id || raw.tagId) : raw);
  if (uid.length < 4 || !subs.length) return false;
  subs[subs.length - 1](uid);
  return true;
}

export function subscribeNfc(fn) {
  install();
  subs.push(fn);
  return () => { const i = subs.lastIndexOf(fn); if (i >= 0) subs.splice(i, 1); };
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.onNfcTag = (id) => emitNfc(id);
  window.addEventListener('apk-nfc-tag', (e) => emitNfc(e.detail));
  const onMsg = (e) => {
    let m = e?.data;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return; } }
    if (m && typeof m === 'object' && /^(NFC_TAG|NFC|NFC_SCAN|NFC_READ)$/.test(String(m.type || ''))) emitNfc(m);
  };
  window.addEventListener('message', onMsg);
  document.addEventListener('message', onMsg);
}
