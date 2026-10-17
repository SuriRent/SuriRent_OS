// KT-V520 printer-modus: het toestel blijft verbonden (ook zonder ingelogde
// medewerker) en print bonnen die de beheerder op afstand stuurt via KTPsdk.
import { api } from './api';
import { apkPrintMessage, apkBridge } from './kiosk-print';

const TOKEN_KEY = 'ktp_device_token';
const NAME_KEY = 'ktp_device_name';
const PING_MS = 20000;

let ws = null;
let pingTimer = null;
let retryTimer = null;
let started = false;

// KT-V520 herkennen via het hardwaremodel in de user-agent (KT-V520 meldt zich als "V520").
// De APK-vlag en een opgeslagen koppel-token zijn onbetrouwbaar: die stonden ook op gewone telefoons.
const KTP_UA = /\bV520\b|KT-?V520|KTV520|KingTop/i;
export const isKtpDevice = () => !!apkBridge() && KTP_UA.test(navigator.userAgent || '');
export const isPairedPrinter = () => isKtpDevice() && !!localStorage.getItem(TOKEN_KEY);
// Naam waaronder dit toestel zelf als printer online staat (om zichzelf uit lijsten te filteren).
export const ownPrinterName = () => (isKtpDevice() ? localStorage.getItem(NAME_KEY) : null);
export const otherPrinters = (list) => { const own = ownPrinterName(); return (list || []).filter((p) => !own || p.name !== own); };

// Gewone telefoon die ooit (per ongeluk) als KT-V520 gekoppeld is: koppeling lokaal opruimen.
if (typeof window !== 'undefined' && !isKtpDevice() && localStorage.getItem(TOKEN_KEY)) {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
}

// Diagnose: wat meldt dit toestel? (meegestuurd met de kiosk-WebSocket)
export function deviceInfo() {
  return {
    ua: (navigator.userAgent || '').slice(0, 300),
    rn_bridge: !!window.ReactNativeWebView?.postMessage,
    android_bridge: typeof window.Android === 'object' && window.Android !== null,
    ktp_flag: window.__SURIRENT_KTP__ === true,
    ktp_detected: isKtpDevice(),
    paired: isPairedPrinter(),
  };
}

const wsUrl = () => `${(process.env.REACT_APP_BACKEND_URL || window.location.origin).replace(/^http/, 'ws')}/api/kiosk/ws`;

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(obj)); } catch { /* noop */ } }
}

// Papierstatus van de ingebouwde printer: APK → web → server (WebSocket).
const PAPER_KEY = 'ktp_paper';
const PAPER_ALIASES = { ok: 'ok', normal: 'ok', full: 'ok', low: 'low', near_end: 'low', nearly_empty: 'low', almost_empty: 'low', near_empty: 'low', empty: 'empty', out: 'empty', no_paper: 'empty', paper_out: 'empty' };
export const getLocalPaper = () => localStorage.getItem(PAPER_KEY) || 'ok';

export function reportPaperStatus(raw) {
  const paper = PAPER_ALIASES[String(raw?.paper ?? raw?.status ?? raw ?? '').trim().toLowerCase()];
  if (!paper) return;
  localStorage.setItem(PAPER_KEY, paper);
  window.dispatchEvent(new CustomEvent('ktp-paper-changed', { detail: { paper } }));
  send({ type: 'PRINTER_STATUS', paper });
}

if (typeof window !== 'undefined') {
  window.onKtpPaperStatus = reportPaperStatus;
  window.addEventListener('ktp-paper-status', (e) => reportPaperStatus(e.detail));
  const onMsg = (e) => {
    let m = e?.data;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return; } }
    if (m && typeof m === 'object' && /^(PRINTER_STATUS|PAPER_STATUS)$/.test(String(m.type || ''))) reportPaperStatus(m);
  };
  window.addEventListener('message', onMsg);
  document.addEventListener('message', onMsg);
}

function handleRemotePrint(msg) {
  try {
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/payments/${msg.payment_id}/print.html?format=thermal&preview=1`;
    const out = apkPrintMessage(url, { ...msg.data, printer: 'kt-v520' });
    out.job_id = msg.job_id;
    out.remote = true;
    const bridge = apkBridge();
    if (!bridge) throw new Error('Geen APK-brug op dit toestel');
    bridge(JSON.stringify(out));
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
    send({ type: 'auth', role: 'printer', device_token: token, device: deviceInfo() });
    if (localStorage.getItem(PAPER_KEY)) send({ type: 'PRINTER_STATUS', paper: getLocalPaper() });
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

async function register(name) {
  const { data } = await api.post('/kiosk/printers/register', name ? { name } : {});
  localStorage.setItem(TOKEN_KEY, data.device_token);
  localStorage.setItem(NAME_KEY, data.name);
  window.dispatchEvent(new Event('ktp-paired'));
  startPrinterMode();
  return data;
}

// Automatisch koppelen tijdens een kiosk-sessie; daarna werkt het toestel zelfstandig.
export async function ensurePrinterRegistered() {
  if (!isKtpDevice()) return;
  if (!isPairedPrinter()) {
    try { await register(); } catch (e) { console.warn('[ktp] koppelen mislukt:', e?.response?.status, e?.message); return; }
  }
  startPrinterMode();
}

// Handmatig koppelen (knop op de beheerder-kiosk) als automatische herkenning faalt.
export async function pairThisDevice(name) {
  if (!isKtpDevice()) throw new Error('Dit toestel is geen KT-V520 — alleen een KT-V520 kan als printer gekoppeld worden.');
  return register(name);
}
