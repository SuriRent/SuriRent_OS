// KT-V520 printer-modus: het toestel blijft verbonden (ook zonder ingelogde
// medewerker) en print bonnen die de beheerder op afstand stuurt via KTPsdk.
import { api } from './api';
import { apkPrintMessage } from './kiosk-print';

const TOKEN_KEY = 'ktp_device_token';
const NAME_KEY = 'ktp_device_name';
const PING_MS = 20000;

let ws = null;
let pingTimer = null;
let retryTimer = null;
let started = false;

// KT-V520 herkennen: APK-vlag window.__SURIRENT_KTP__ óf het toestelmodel in de user-agent.
const KTP_UA = /KT-?V520|KTV520|KingTop/i;
export const isKtpDevice = () => typeof window !== 'undefined' && !!window.ReactNativeWebView
  && (window.__SURIRENT_KTP__ === true || KTP_UA.test(navigator.userAgent || ''));

const wsUrl = () => `${(process.env.REACT_APP_BACKEND_URL || window.location.origin).replace(/^http/, 'ws')}/api/kiosk/ws`;

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(obj)); } catch { /* noop */ } }
}

function handleRemotePrint(msg) {
  try {
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/payments/${msg.payment_id}/print.html?format=thermal&preview=1`;
    const out = apkPrintMessage(url, { ...msg.data, printer: 'kt-v520' });
    out.job_id = msg.job_id;
    out.remote = true;
    window.ReactNativeWebView.postMessage(JSON.stringify(out));
    send({ type: 'REMOTE_PRINT_DONE', job_id: msg.job_id, payment_id: msg.payment_id, ok: true });
  } catch (e) {
    send({ type: 'REMOTE_PRINT_DONE', job_id: msg.job_id, payment_id: msg.payment_id, ok: false, error: String(e?.message || e) });
  }
}

function connect() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try { ws = new WebSocket(wsUrl()); } catch { scheduleRetry(); return; }
  ws.onopen = () => {
    send({ type: 'auth', role: 'printer', device_token: token });
    pingTimer = setInterval(() => send({ type: 'ping' }), PING_MS);
  };
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'REMOTE_PRINT' && msg.payment_id) handleRemotePrint(msg);
  };
  ws.onclose = (e) => {
    clearInterval(pingTimer);
    // 4401 = toestel ontkoppeld door de beheerder → token wissen.
    if (e.code === 4401) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NAME_KEY); return; }
    scheduleRetry();
  };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, 5000);
}

export function startPrinterMode() {
  if (started || !isKtpDevice() || !localStorage.getItem(TOKEN_KEY)) return;
  started = true;
  connect();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState === WebSocket.CLOSED)) { clearTimeout(retryTimer); connect(); }
  });
}

// Eenmalig koppelen tijdens een kiosk-sessie; daarna werkt het toestel zelfstandig.
export async function ensurePrinterRegistered() {
  if (!isKtpDevice()) return;
  if (!localStorage.getItem(TOKEN_KEY)) {
    try {
      const { data } = await api.post('/kiosk/printers/register', {});
      localStorage.setItem(TOKEN_KEY, data.device_token);
      localStorage.setItem(NAME_KEY, data.name);
    } catch (e) { console.warn('[ktp] koppelen mislukt:', e?.response?.status, e?.message); return; }
  }
  startPrinterMode();
}
