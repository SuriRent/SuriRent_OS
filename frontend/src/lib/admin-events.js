/**
 * useAdminEvents — Server-Sent Events stream voor instant admin updates.
 *
 * SINGLETON PATTERN. Voorheen opende elke hook-instantie een eigen
 * EventSource-connection — met 4-5 hooks tegelijk (Bells + Payments +
 * Dashboard) resulteerde dat in 4-5 parallelle SSE-connecties per tab.
 * Browsers/proxies throttlen dat (max 6 per domein incl. andere requests),
 * waardoor sommige connecties nooit bytes doorkregen en updates traag
 * of niet aankwamen.
 *
 * Nu: EEN gedeelde EventSource op module-niveau met pub/sub. Alle hooks
 * abonneren zich op dezelfde stream. Auto-reconnect met exp-backoff.
 * Latency: <100ms van backend broadcast tot React callback.
 *
 * DEFAULT BEHAVIOR (2026-02):
 *   • Auto-registreert een globale SWR-invalidator zodat een change-event
 *     op device A ALTIJD SWR caches op device B refresht — óók op pagina's
 *     die zelf geen useAdminEvents hook hebben (Invoices, Companies, …).
 *   • `visibilitychange` → bij terugkeer uit sleep: force reconnect +
 *     revalidate alles zodat mobiel na screen-lock weer instant sync heeft.
 */
import { useEffect, useRef } from 'react';
import { mutate as swrGlobalMutate } from 'swr';

// --- Singleton state (module-scope) -----------------------------------
let _es = null;
let _closed = false;
let _retryTimer = null;
let _retryDelay = 1000;
let _hadFirstConnect = false;
let _visibilityBound = false;
const _listeners = new Set();

function _dispatch(data) {
  // Kopieer eerst — een listener mag zichzelf uit-registreren tijdens
  // zijn eigen callback zonder de iteratie stuk te maken.
  Array.from(_listeners).forEach((fn) => {
    try { fn(data); } catch { /* zwijgende fout: 1 listener mag anderen niet breken */ }
  });
}

// =====================================================================
// Global SWR invalidator — draait ALTIJD zodra we minstens één keer
// verbonden zijn geweest. Zorgt dat een change op device A → SWR caches
// op device B automatisch revalideren, ook als de huidige pagina geen
// eigen useAdminEvents hook heeft.
// =====================================================================
function _globalInvalidate(data) {
  if (data?.type !== 'change' && data?.type !== 'notification') return;
  try { window.dispatchEvent(new CustomEvent('surirent:live-change', { detail: data })); } catch { /* noop */ }
  try {
    const rawPath = String(data?.path || '');
    if (!rawPath.startsWith('/api/')) return;
    const swrKey = rawPath.slice(4);
    // 1) Alle keys die onder het gemuteerde API-pad vallen
    swrGlobalMutate(
      (k) => typeof k === 'string' && (
        k === swrKey || k.startsWith(swrKey + '/') || swrKey.startsWith(k + '/') || swrKey.startsWith(k + '?')
      ),
      undefined,
      { revalidate: true },
    );
    // 2) Cross-collectie afhankelijkheden — bijv. betaling raakt facturen én plans
    const crossInvalidate = ['/admin/stats'];
    if (swrKey.startsWith('/payments')) {
      crossInvalidate.push('/invoices', '/payment-plans', '/payment-plans?status=active', '/tenants');
    }
    if (swrKey.includes('/assign-tenant') || swrKey.includes('/remove-tenant')) {
      crossInvalidate.push('/tenants', '/apartments');
    }
    if (swrKey.startsWith('/contracts')) crossInvalidate.push('/tenants', '/apartments');
    if (swrKey.startsWith('/payment-plans') || swrKey.startsWith('/invoices')) {
      crossInvalidate.push('/payment-plans?status=active', '/payment-plans');
    }
    if (swrKey.startsWith('/tenants') || swrKey.startsWith('/apartments')) {
      crossInvalidate.push('/tenants', '/apartments');
    }
    crossInvalidate.forEach((base) => {
      swrGlobalMutate(
        (k) => typeof k === 'string' && (k === base || k.startsWith(base + '/') || k.startsWith(base + '?')),
        undefined,
        { revalidate: true },
      );
    });
  } catch { /* noop */ }
}

// =====================================================================
// Force full revalidate — na reconnect (bijv. iOS sleep→wake) missen we
// mogelijk events die tijdens de disconnect uitgezonden werden. We
// revalideren alle actieve SWR-keys zodat de UI 100% in-sync komt met
// server-state, ongeacht welke events we misten.
// =====================================================================
function _forceFullRevalidate() {
  try {
    swrGlobalMutate((k) => typeof k === 'string' && k.startsWith('/'), undefined, { revalidate: true });
  } catch { /* noop */ }
}

// visibilitychange handler — één keer registreren, ongeacht hoeveel
// hook-instances er zijn. Bij `visible` na sleep: sluit stale connection
// en force reconnect + revalidate.
function _bindVisibility() {
  if (_visibilityBound || typeof document === 'undefined') return;
  _visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || _closed) return;
    // Bij visible: check of ES nog leeft. EventSource.readyState 2 = CLOSED.
    const stale = !_es || _es.readyState === 2;
    if (stale) {
      if (_es) { try { _es.close(); } catch { /* noop */ } _es = null; }
      _retryDelay = 500;  // snelle reconnect na wake
      _connect();
    }
    // In beide gevallen: force full revalidate om gemiste events te
    // repareren. Zonder deze stap zou mobiel na screen-lock stale data
    // tonen tot de eerste nieuwe change binnenkomt.
    _forceFullRevalidate();
  });
  // Ook `online` event (na netwerkverlies) triggert dezelfde flow
  window.addEventListener('online', () => {
    if (_closed) return;
    if (!_es || _es.readyState === 2) {
      if (_es) { try { _es.close(); } catch { /* noop */ } _es = null; }
      _retryDelay = 500;
      _connect();
    }
    _forceFullRevalidate();
  });
}

function _connect() {
  if (_closed || _es) return;
  _bindVisibility();
  const apiBase = `${process.env.REACT_APP_BACKEND_URL}/api`;
  const token =
    localStorage.getItem('admin_token') ||
    localStorage.getItem('access_token') ||
    '';
  const url = token
    ? `${apiBase}/admin/events?token=${encodeURIComponent(token)}`
    : `${apiBase}/admin/events`;
  try {
    _es = new EventSource(url, { withCredentials: true });
  } catch {
    _scheduleRetry();
    return;
  }
  _es.onopen = () => {
    _retryDelay = 1000;
    // Na een RE-connect (niet de eerste): revalidate alles zodat we niks
    // missen dat tijdens de disconnect gebeurde. Bij eerste connect is
    // dat overbodig — pagina laadt sowieso via initial SWR fetch.
    if (_hadFirstConnect) _forceFullRevalidate();
    _hadFirstConnect = true;
  };
  _es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      // Eerst globale invalidator, daarna hook-specifieke listeners.
      // Zo krijgen alle pagina's automatisch SWR-refresh — hooks blijven
      // vrij voor pagina-specifieke effects (toast, teller, animatie).
      _globalInvalidate(data);
      _dispatch(data);
    } catch { /* ignore parse errors */ }
  };
  _es.onerror = () => {
    if (_es) { try { _es.close(); } catch { /* noop */ } _es = null; }
    _scheduleRetry();
  };
}

function _scheduleRetry() {
  if (_closed) return;
  if (_retryTimer) clearTimeout(_retryTimer);
  _retryTimer = setTimeout(() => { _retryTimer = null; _connect(); }, _retryDelay);
  _retryDelay = Math.min(_retryDelay * 1.5, 30000);
}

function _ensureConnected() {
  _closed = false;
  if (!_es && !_retryTimer) _connect();
}

/** Bootstrap zonder React-hook — vanuit AuthProvider aan te roepen zodra
 *  de admin ingelogd is, zodat SSE actief is óók op pagina's die geen
 *  eigen `useAdminEvents` gebruiken (Facturen-lijst, Bedrijven, …). */
export function bootstrapAdminEvents() {
  _ensureConnected();
}

/** Sluit alles bij logout — anders blijft de connectie hangen met stale token. */
export function closeAdminEvents() {
  _closed = true;
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  if (_es) { try { _es.close(); } catch { /* noop */ } _es = null; }
  _listeners.clear();
}

/**
 * React hook — registreert een listener op de gedeelde SSE-stream.
 * @param {(evt:any)=>void} onEvent
 * @param {{enabled?: boolean}} opts
 */
export function useAdminEvents(onEvent, { enabled = true } = {}) {
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (data) => {
      try { onEventRef.current && onEventRef.current(data); } catch { /* noop */ }
    };
    _listeners.add(listener);
    _ensureConnected();
    return () => {
      _listeners.delete(listener);
      // Als er niemand meer luistert, mogen we de connectie behouden:
      // hij is goedkoop (1 idle SSE) en re-open vertraagt UX. We sluiten
      // pas expliciet via `closeAdminEvents()` bij logout.
    };
  }, [enabled]);
}
