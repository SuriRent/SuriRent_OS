import { api } from './api';

// Keuzescherm-data (appartementen + locaties): laatst bekende versie direct tonen,
// daarna op de achtergrond verversen.
const LS_KEY = 'kiosk_select_cache_v1';
let inflight = null;
let lastFresh = null; // { at, data } — dedupe mount-fetch direct na prefetch
const FRESH_MS = 3000;

const scopeKey = () => {
  try { return localStorage.getItem('kiosk_company') || ''; } catch { return ''; }
};

export function readKioskSelectCache() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return c && c.scope === scopeKey() ? c : null;
  } catch { return null; }
}

export function fetchKioskSelect() {
  if (inflight) return inflight;
  if (lastFresh && Date.now() - lastFresh.at < FRESH_MS && lastFresh.data.scope === scopeKey()) return Promise.resolve(lastFresh.data);
  inflight = Promise.all([api.get('/kiosk/apartments'), api.get('/kiosk/locations')])
    .then(([a, l]) => {
      const data = { scope: scopeKey(), apartments: a.data || [], locations: l.data || [] };
      lastFresh = { at: Date.now(), data };
      try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* opslag vol */ }
      return data;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function clearKioskSelectCache() {
  lastFresh = null;
  try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
}

// Start direct bij het laden van de kiosk-chunk, nog vóór de eerste render.
export function prefetchKioskSelect() {
  try { if (!localStorage.getItem('kiosk_token')) return; } catch { return; }
  fetchKioskSelect().catch(() => {});
}

// Forceer een verse fetch bij de volgende mount (bv. na aanmaken appartement).
export function invalidateKioskSelect() {
  lastFresh = null;
}
