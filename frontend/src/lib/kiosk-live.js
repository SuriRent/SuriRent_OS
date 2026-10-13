import { printReceipt } from './kiosk-print';
import { api } from './api';

// Kiosk live-kanaal (WebSocket). Draait buiten React: alleen abonnees
// (het statusbolletje) renderen bij een wijziging.
const DEBOUNCE_MS = 2000;
const PING_MS = 5000;

let ws = null;
let role = null;
let pingTimer = null;
let retryTimer = null;
let stopped = true;
let state = { connected: false, active: false, count: 0, toast: null };
const listeners = new Set();

let presenceTimer = null;
let pendingPresence = null;
let printTimer = null;
const pendingPrints = new Map(); // payment_id -> employee

const emit = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const subscribeKioskLive = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const getKioskLiveState = () => state;

const wsUrl = () => `${(process.env.REACT_APP_BACKEND_URL || window.location.origin).replace(/^http/, 'ws')}/api/kiosk/ws`;

function helloMsg() {
  const m = { type: 'auth', role, token: localStorage.getItem('kiosk_token') || '' };
  if (role === 'admin') m.admin_token = localStorage.getItem('admin_token') || '';
  else m.name = localStorage.getItem('kiosk_emp_name') || localStorage.getItem('device_user_name') || '';
  return m;
}

// Snelle opeenvolgende berichten samenvoegen (2 s debounce).
function queuePresence(msg) {
  pendingPresence = msg;
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => {
    emit({ active: !!pendingPresence.active, count: pendingPresence.count || 0 });
  }, DEBOUNCE_MS);
}

function queuePrint(msg) {
  pendingPrints.set(msg.payment_id, msg.employee || '');
  clearTimeout(printTimer);
  printTimer = setTimeout(async () => {
    const batch = [...pendingPrints.entries()];
    pendingPrints.clear();
    const who = batch.map(([, e]) => e).filter(Boolean)[0];
    emit({ toast: { ids: batch.map(([id]) => id), who, at: Date.now() } });
    for (const [paymentId] of batch) {
      // eslint-disable-next-line no-await-in-loop
      await printReceipt({ paymentId, apiGet: api.get, relay: false });
    }
  }, DEBOUNCE_MS);
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
    if (msg.type === 'presence') queuePresence(msg);
    else if (msg.type === 'PRINT_RECEIPT' && msg.payment_id) queuePrint(msg);
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    emit({ connected: false });
    scheduleRetry();
  };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!stopped) retryTimer = setTimeout(connect, 3000);
}

function sendJson(obj) {
  if (ws?.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch { /* verbinding net weg */ }
  }
}

// Medewerker print een bon → asynchroon doorsturen naar de beheerder-kiosk.
const onPrinted = (e) => {
  if (role === 'employee' && e.detail?.paymentId) setTimeout(() => sendJson({ type: 'PRINT_RECEIPT', payment_id: e.detail.paymentId }), 0);
};

export function startKioskLive(asRole) {
  if (!stopped && role === asRole) return;
  stopKioskLive();
  role = asRole;
  stopped = false;
  window.addEventListener('kiosk-receipt-printed', onPrinted);
  connect();
}

export function stopKioskLive() {
  stopped = true;
  window.removeEventListener('kiosk-receipt-printed', onPrinted);
  clearTimeout(retryTimer); clearInterval(pingTimer);
  clearTimeout(presenceTimer); clearTimeout(printTimer);
  pendingPrints.clear();
  if (ws) { ws.onclose = null; try { ws.close(); } catch { /* noop */ } ws = null; }
  state = { connected: false, active: false, count: 0, toast: null };
}

export function clearKioskLiveToast() { emit({ toast: null }); }
