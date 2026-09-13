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
 */
import { useEffect, useRef } from 'react';

// --- Singleton state (module-scope) -----------------------------------
let _es = null;
let _closed = false;
let _retryTimer = null;
let _retryDelay = 1000;
const _listeners = new Set();

function _dispatch(data) {
  // Kopieer eerst — een listener mag zichzelf uit-registreren tijdens
  // zijn eigen callback zonder de iteratie stuk te maken.
  Array.from(_listeners).forEach((fn) => {
    try { fn(data); } catch { /* zwijgende fout: 1 listener mag anderen niet breken */ }
  });
}

function _connect() {
  if (_closed || _es) return;
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
  _es.onopen = () => { _retryDelay = 1000; };
  _es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
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
