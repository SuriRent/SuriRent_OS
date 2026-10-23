import { apkKioskId, deviceInfo } from './ktp-printer';
// Kiosk live-kanaal (WebSocket). Draait buiten React: alleen abonnees
// (het statusbolletje) renderen bij een wijziging.
const DEBOUNCE_MS = 2000;
const PING_MS = 20000;

let ws = null;
let role = null;
let pingTimer = null;
let retryTimer = null;
let stopped = true;
const INITIAL = { connected: false, active: false, count: 0, employees: [], printers: [], printersKnown: false, printsVersion: 0, overlayOpen: false };
let state = INITIAL;
// Grace: kort wegvallen van een medewerker (netwerk-hapering) sluit het venster niet.
const EMPTY_GRACE_MS = 15000;
let emptyTimer = null;
const listeners = new Set();

let presenceTimer = null;
let pendingPresence = null;
let printTimer = null;

const emit = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const subscribeKioskLive = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const getKioskLiveState = () => state;

const wsUrl = () => `${(process.env.REACT_APP_BACKEND_URL || window.location.origin).replace(/^http/, 'ws')}/api/kiosk/ws`;

function helloMsg() {
  const m = { type: 'auth', role, token: localStorage.getItem('kiosk_token') || '', device: deviceInfo(), kiosk_id: apkKioskId() };
  if (role === 'admin') m.admin_token = localStorage.getItem('admin_token') || '';
  else {
    m.name = localStorage.getItem('kiosk_emp_name') || localStorage.getItem('device_user_name') || '';
    m.employee_id = localStorage.getItem('kiosk_emp_id') || localStorage.getItem('device_user_email') || '';
  }
  return m;
}

// Snelle opeenvolgende berichten samenvoegen (2 s debounce).
function queuePresence(msg) {
  pendingPresence = msg;
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => {
    const employees = pendingPresence.employees || [];
    if (employees.length) {
      // Venster blijft open zolang er een medewerker ingelogd is; een nieuwe
      // medewerker heropent het ook als de beheerder het had gesloten.
      clearTimeout(emptyTimer); emptyTimer = null;
      const prev = new Set(state.employees.map((e) => e.key));
      const isNew = employees.some((e) => !prev.has(e.key));
      emit({ active: true, count: employees.length, employees, ...(isNew ? { overlayOpen: true } : {}) });
    } else if (state.employees.length && !emptyTimer) {
      emptyTimer = setTimeout(() => {
        emptyTimer = null;
        // Venster blijft open: bonnen van vandaag blijven zichtbaar, ook als de medewerker offline is.
        emit({ active: false, count: 0, employees: [] });
      }, EMPTY_GRACE_MS);
    } else if (!state.employees.length) {
      emit({ active: false, count: 0 });
    }
  }, DEBOUNCE_MS);
}

// Bon-berichten samenvoegen: na 2 s rust één refresh van de bonnenlijst.
function queuePrint() {
  clearTimeout(printTimer);
  printTimer = setTimeout(() => emit({ printsVersion: state.printsVersion + 1 }), DEBOUNCE_MS);
}

function connect() {
  if (stopped || !localStorage.getItem('kiosk_token')) return;
  try { ws = new WebSocket(wsUrl()); } catch { scheduleRetry(); return; }
  ws.onopen = () => {
    sendJson(helloMsg());
    emit({ connected: true });
    pingTimer = setInterval(() => sendJson({ type: 'ping' }), PING_MS);
  };
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'printers') {
      if (!state.printersKnown || JSON.stringify(msg.printers || []) !== JSON.stringify(state.printers)) emit({ printers: msg.printers || [], printersKnown: true });
      return;
    }
    if (msg.type === 'presence') {
      if (!state.printersKnown || JSON.stringify(msg.printers || []) !== JSON.stringify(state.printers)) emit({ printers: msg.printers || [], printersKnown: true });
      queuePresence(msg);
    } else if (msg.type === 'overview_invalidate') {
      window.dispatchEvent(new CustomEvent('kiosk-overview-invalidate', { detail: { tenant_id: msg.tenant_id } }));
    } else if (msg.type === 'REMOTE_PRINT_DONE') {
      window.dispatchEvent(new CustomEvent('ktp-remote-print-done', { detail: msg }));
      if (msg.ok) queuePrint();
    }
    else if (msg.type === 'PRINT_RECEIPT' && msg.payment_id) queuePrint();
    else if (msg.type === 'id_scan') {
      window.dispatchEvent(new CustomEvent('kiosk-id-scan', { detail: msg }));
    }
    else if (msg.type === 'kiosk_theme') {
      window.dispatchEvent(new CustomEvent('kiosk-theme', { detail: msg.theme }));
    }
    else if (msg.type === 'device_config') {
      // Live printer-keuze (Instellingen → Kiosk apparaten); bewaard voor offline.
      if (msg.printer) localStorage.setItem('kiosk_printer', msg.printer); else localStorage.removeItem('kiosk_printer');
      localStorage.setItem('kiosk_paper_width', String(msg.paper_width || 58));
      emit({ printer: msg.printer || null });
    }
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    emit({ connected: false, printersKnown: false });
    scheduleRetry();
  };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!stopped) retryTimer = setTimeout(connect, 3000);
}

export function sendKioskLive(obj) { sendJson(obj); }

function sendJson(obj) {
  if (ws?.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch { /* verbinding net weg */ }
  }
}

// Medewerker print een bon → asynchroon doorsturen naar de beheerder-kiosk.
const onPrinted = (e) => {
  if (role === 'employee' && e.detail?.paymentId) setTimeout(() => sendJson({ type: 'PRINT_RECEIPT', payment_id: e.detail.paymentId }), 0);
};

// Terug in beeld (APK/PWA uit slaap) → direct pingen of opnieuw verbinden.
const onVisible = () => {
  if (document.visibilityState !== 'visible' || stopped) return;
  if (ws?.readyState === WebSocket.OPEN) sendJson({ type: 'ping' });
  else if (!ws || ws.readyState === WebSocket.CLOSED) { clearTimeout(retryTimer); connect(); }
};

export function startKioskLive(asRole) {
  if (!stopped && role === asRole) return;
  stopKioskLive();
  role = asRole;
  stopped = false;
  window.addEventListener('kiosk-receipt-printed', onPrinted);
  document.addEventListener('visibilitychange', onVisible);
  connect();
}

// Medewerker logt uit → server meldt dit direct aan de beheerders.
export function kioskLiveBye() {
  if (role === 'employee') sendJson({ type: 'BYE' });
}

export function stopKioskLive() {
  kioskLiveBye();
  stopped = true;
  window.removeEventListener('kiosk-receipt-printed', onPrinted);
  document.removeEventListener('visibilitychange', onVisible);
  clearTimeout(retryTimer); clearInterval(pingTimer);
  clearTimeout(presenceTimer); clearTimeout(printTimer); clearTimeout(emptyTimer); emptyTimer = null;
  if (ws) { ws.onclose = null; try { ws.close(); } catch { /* noop */ } ws = null; }
  state = INITIAL;
}

export const setKioskOverlayOpen = (open) => emit({ overlayOpen: open });

// Wie is er ingelogd op dit apparaat? Zelfde sleutel op telefoon en desktop = zelfde persoon.
export const getKioskUserKey = () => (
  localStorage.getItem('device_user_email') || localStorage.getItem('kiosk_emp_id') || ''
).trim().toLowerCase();
