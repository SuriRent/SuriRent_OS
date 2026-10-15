// Android-app (APK) FCM-token koppelen aan de ingelogde beheerder.
// APK-protocol: web → {type:"FCM_GET_TOKEN"}; APK → window event 'apk-fcm-token' {token, device_name}
// of vooraf window.__SURIRENT_FCM_TOKEN__ zetten.
import { api } from './api';
import { apkBridge } from './kiosk-print';

const KEY = 'fcm_token_registered';
let installed = false;

async function register(token, deviceName) {
  if (!token) return;
  try {
    await api.post('/push/fcm/register', { token, device_name: deviceName || undefined });
    localStorage.setItem(KEY, token);
    window.dispatchEvent(new Event('fcm-registered'));
  } catch (e) { console.warn('[fcm] registreren mislukt:', e?.response?.status); }
}

export const isApkApp = () => !!apkBridge();

export function requestFcmToken() {
  const bridge = apkBridge();
  if (bridge) { try { bridge(JSON.stringify({ type: 'FCM_GET_TOKEN' })); } catch { /* noop */ } }
}

export function installFcmApk() {
  if (installed || !apkBridge()) return;
  installed = true;
  window.addEventListener('apk-fcm-token', (e) => register(e.detail?.token, e.detail?.device_name));
  if (window.__SURIRENT_FCM_TOKEN__) register(window.__SURIRENT_FCM_TOKEN__, window.__SURIRENT_DEVICE_NAME__);
  requestFcmToken();
}
