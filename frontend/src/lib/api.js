import axios from 'axios';

const baseURL = `${process.env.REACT_APP_BACKEND_URL}/api`;

// httpOnly auth cookies (access_token / kiosk_token / tenant_token) worden
// door de backend gezet bij login en automatisch meegestuurd via
// `withCredentials: true`. Dit is de PRIMAIRE auth-flow. We behouden de
// legacy `Authorization: Bearer <localStorage-token>` fallback hieronder
// puur voor overgangs-compatibiliteit met bestaande PWA's die nog een
// token in localStorage hebben staan — bij volgende login (waar cookies
// gezet worden) wordt localStorage tokens vanzelf overbodig.
export const api = axios.create({
  baseURL,
  withCredentials: true,
});

let getRequestSequence = 0;

// Attach bearer token if present (fallback to cookie auth)
api.interceptors.request.use((config) => {
  config._t0 = performance.now(); // voor trage-verbinding detectie
  if ((config.method || 'get').toLowerCase() === 'get') {
    // Live app-data moet altijd opnieuw bij de backend worden gevalideerd,
    // niet uit de browser- of service-worker-cache komen.
    config.params = { ...(config.params || {}), nocache: `${Date.now()}-${++getRequestSequence}` };
  }
  const adminToken = localStorage.getItem('admin_token');
  const kioskToken = localStorage.getItem('kiosk_token');
  const tenantToken = localStorage.getItem('tenant_token');
  const activeCompanyId = localStorage.getItem('active_company_id');
  const url = config.url || '';
  // Token-keuze op basis van endpoint, NIET op basis van wat als eerste in
  // localStorage staat. Anders zou een stale admin_token de voorkeur krijgen
  // op kiosk-endpoints en alles met 401 falen (klassieke bug na fresh PIN
  // entry waarbij oude admin sessie nog blijft hangen).
  if (url.startsWith('/tenant-portal/') && tenantToken) {
    config.headers.Authorization = `Bearer ${tenantToken}`;
  } else if (url.startsWith('/kiosk/') && kioskToken) {
    // Élke /kiosk/* endpoint gebruikt PRIMAIR het kiosk_token.
    config.headers.Authorization = `Bearer ${kioskToken}`;
  } else if (adminToken) {
    config.headers.Authorization = `Bearer ${adminToken}`;
  } else if (kioskToken && localStorage.getItem('kiosk_admin_cookie') !== '1') {
    config.headers.Authorization = `Bearer ${kioskToken}`;
  } else if (tenantToken) {
    config.headers.Authorization = `Bearer ${tenantToken}`;
  }
  // Superadmin company scope: only set for admin-authenticated calls
  if (activeCompanyId && adminToken) {
    config.headers['x-active-company'] = activeCompanyId;
  }
  return config;
});

// Auth-fouten mogen een actieve adminsessie niet wissen of de gebruiker
// automatisch uit de app sturen. De loginstatus blijft behouden; de pagina
// kan de fout tonen en de gebruiker kan zelf opnieuw proberen of uitloggen.
const PUBLIC_401_PATHS = [
  '/auth/login', '/auth/register', '/auth/kiosk-pin',
  '/tenant-portal/login', '/tenant-portal/pin-login',
];
// Meet duur van gewone GET-calls (geen blobs) voor de "Trage verbinding"-melding.
const reportTiming = (cfg) => {
  if (!cfg?._t0 || (cfg.method || 'get') !== 'get' || cfg.responseType === 'blob') return;
  try { window.dispatchEvent(new CustomEvent('surirent:req-time', { detail: performance.now() - cfg._t0 })); } catch { /* noop */ }
};

api.interceptors.response.use(
  (r) => { reportTiming(r.config); return r; },
  (err) => {
    // Geen response (geen internet / server onbereikbaar) → offline-scherm laat zelf pingen.
    if (!err?.response && err?.code !== 'ERR_CANCELED') {
      try { window.dispatchEvent(new CustomEvent('surirent:network-error')); } catch { /* noop */ }
    }
    // Note: HTTP 402 billing-blocked flow is DEPRECATED. De backend blokkeert
    // niet meer op verlopen abonnement — klanten mogen doorgebruiken en zien
    // alleen de TrialBanner. We ruimen eventuele oude localStorage sleutels
    // op zodat gebruikers die eerder geblokkeerd waren automatisch loskomen.
    try {
      if (localStorage.getItem('billing_blocked_status')) {
        localStorage.removeItem('billing_blocked_status');
        localStorage.removeItem('billing_blocked_message');
      }
    } catch { /* ignore */ }
    if (err?.response?.status === 401) {
      const url = (err.config?.url || '');
      const isPublic = PUBLIC_401_PATHS.some((p) => url.startsWith(p));
      if (!isPublic) {
        const path = (typeof window !== 'undefined' && window.location?.pathname) || '';
        const isTenantContext = url.startsWith('/tenant-portal/')
          || path.includes('/kiosk/huurder')
          || path.includes('/kiosk/klant')
          || path.startsWith('/huurder');
        const isKioskContext = url.startsWith('/kiosk/') || path === '/kiosk' || path.startsWith('/kiosk/');
        const detail = String(err.response?.data?.detail || '').toLowerCase();
        const isAuthFailure = !detail || [
          'niet ingelogd', 'token verlopen', 'ongeldig token',
          'ongeldig token type', 'gebruiker niet gevonden',
        ].some((message) => detail.includes(message));
        if (isAuthFailure && !isTenantContext && !isKioskContext) {
          try { window.dispatchEvent(new CustomEvent('surirent:auth-error')); } catch { /* noop */ }
        }
      }
    }
    return Promise.reject(err);
  }
);

export function formatError(err, fallback = 'Er is iets misgegaan') {
  const detail = err?.response?.data?.detail;
  if (detail == null) return err?.message || fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === 'string' ? e.msg : JSON.stringify(e))).join(' ');
  if (detail && typeof detail.msg === 'string') return detail.msg;
  return String(detail);
}

export function fmtMoney(amount, currency = 'SRD') {
  const n = Number(amount || 0);
  return `${currency} ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Open een PDF endpoint dat auth vereist in een nieuw tabblad.
 *  `window.open(url)` stuurt geen Authorization-header — als de huurder via
 *  Bearer-token is ingelogd (en niet via cookie) krijgt het backend "Niet
 *  ingelogd". Met `responseType:'blob'` haalt axios het PDF met juiste auth,
 *  en openen we de blob-URL in een nieuw tabblad. */
export async function openAuthedPdf(path, { filename } = {}) {
  const { data } = await api.get(path, { responseType: 'blob' });
  const blob = new Blob([data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) {
    // Popup geblokkeerd → forceer download zodat de gebruiker iets krijgt.
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Revoke na 60s — genoeg tijd voor PDF te laden in nieuw tabblad.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const MONTHS_NL = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];
