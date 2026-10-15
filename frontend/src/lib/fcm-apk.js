// Android-app (APK) Firebase-token koppelen aan de ingelogde beheerder.
// Vangt alle gangbare manieren op waarop de APK het token kan doorgeven:
// - event 'apk-fcm-token' {detail:{token, device_name}}
// - postMessage/injectJavaScript → window/document 'message' (JSON of kale token-string)
// - window-variabelen (__SURIRENT_FCM_TOKEN__, fcmToken, FCM_TOKEN, ...)
// - JS-interface getters (window.Android.getFcmToken(), ...)
// - localStorage (fcm_token, fcmToken, ...)
import { api } from './api';
import { apkBridge } from './kiosk-print';

const KEY = 'fcm_token_registered';
const FCM_RE = /^[\w-]{10,}:[\w-]{80,}$/;
const WIN_KEYS = ['__SURIRENT_FCM_TOKEN__', '__FCM_TOKEN__', 'fcmToken', 'FCM_TOKEN', 'fcm_token', 'firebaseToken', 'pushToken', 'devicePushToken'];
const LS_KEYS = ['fcm_token', 'fcmToken', 'FCM_TOKEN', 'firebase_token', 'pushToken', 'push_token'];
const GETTERS = ['getFcmToken', 'getFCMToken', 'getFirebaseToken', 'getPushToken', 'getToken'];
const MSG_TYPES = /fcm|push|firebase|token/i;

let installed = false;
let lastToken = '';
const status = { apk: false, token: '', registered: false, error: '' };

export const isApkApp = () => !!apkBridge() || typeof window.Android === 'object';
export const fcmStatus = () => ({ ...status, apk: isApkApp() });
const emit = () => window.dispatchEvent(new Event('fcm-status'));

const valid = (t) => typeof t === 'string' && FCM_RE.test(t.trim());

function deviceName(extra) {
  if (extra) return String(extra).slice(0, 80);
  if (window.__SURIRENT_DEVICE_NAME__) return String(window.__SURIRENT_DEVICE_NAME__).slice(0, 80);
  const m = (navigator.userAgent || '').match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
  return m ? m[1].trim() : 'Android-toestel';
}

async function register(token, name, caps) {
  if (!valid(token)) return;
  token = token.trim();
  status.token = token;
  if (token === lastToken && status.registered) return;
  lastToken = token;
  try {
    const capabilities = caps || window.__SURIRENT_FCM_CAPS__;
    await api.post('/push/fcm/register', { token, device_name: deviceName(name), capabilities: Array.isArray(capabilities) ? capabilities : undefined });
    localStorage.setItem(KEY, token);
    status.registered = true; status.error = '';
    window.dispatchEvent(new Event('fcm-registered'));
  } catch (e) {
    status.registered = false; lastToken = '';
    status.error = e?.response?.data?.detail || 'Koppelen mislukt';
  }
  emit();
}

function fromPayload(raw) {
  if (valid(raw)) return { token: raw };
  let m = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return null; } }
  if (!m || typeof m !== 'object') return null;
  const src = m.data && typeof m.data === 'object' ? { ...m, ...m.data } : m;
  const token = src.token || src.fcmToken || src.fcm_token || src.pushToken || src.firebaseToken || src.value;
  if (!valid(token) || (src.type && !MSG_TYPES.test(String(src.type)))) return null;
  return { token, name: src.device_name || src.deviceName || src.model, caps: src.capabilities };
}

function scan() {
  for (const k of WIN_KEYS) if (valid(window[k])) return register(window[k]);
  const a = window.Android;
  if (a) for (const g of GETTERS) {
    if (typeof a[g] === 'function') { try { const t = a[g](); if (valid(t)) return register(t); } catch { /* noop */ } }
  }
  for (const k of LS_KEYS) { const t = localStorage.getItem(k); if (valid(t)) return register(t); }
  return null;
}

export function requestFcmToken() {
  const bridge = apkBridge();
  if (bridge) {
    for (const type of ['FCM_GET_TOKEN', 'GET_FCM_TOKEN', 'REQUEST_FCM_TOKEN']) {
      try { bridge(JSON.stringify({ type })); } catch { /* noop */ }
    }
  }
  lastToken = '';
  scan();
}

let poll = null;

// Tik op melding: APK roept window.onFcmOpen(url) aan of stuurt {type:'FCM_OPEN', url}.
export function openFromNotification(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return;
  const base = window.location.pathname.match(/^(.*?)\/admin(\/|$)/)?.[1] || '';
  window.history.pushState({}, '', `${base}${url}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function openPayload(raw) {
  let m = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return null; } }
  if (!m || typeof m !== 'object' || !/^(FCM_OPEN|NOTIFICATION_OPEN|OPEN_URL)$/.test(String(m.type || ''))) return null;
  return m.url || m.data?.url || null;
}

// Bij elke (her)start van het beheer opnieuw koppelen: luisteraars één keer, token opnieuw opvragen.
export function installFcmApk() {
  if (!installed) {
    installed = true;
    const onMsg = (e) => {
      const url = openPayload(e?.data);
      if (url) { openFromNotification(url); return; }
      const r = fromPayload(e?.data); if (r) register(r.token, r.name, r.caps);
    };
    window.addEventListener('apk-fcm-token', (e) => register(e.detail?.token, e.detail?.device_name, e.detail?.capabilities));
    window.addEventListener('message', onMsg);
    document.addEventListener('message', onMsg);
    window.onFcmToken = (t, name, caps) => register(t, name, caps);
    window.onFcmOpen = openFromNotification;
  }
  if (!isApkApp()) return;
  status.registered = false;
  requestFcmToken();
  clearInterval(poll);
  let n = 0;
  poll = setInterval(() => { n += 1; if (status.registered || n > 30) clearInterval(poll); else scan(); }, 2000);
  emit();
}
