// SWR-configured helpers + fetcher voor de app. Wraps onze bestaande axios
// `api` instance zodat auth-headers meelopen. Gebruik:
//
//    import { useApiSWR } from '../../lib/swr';
//    const { data, isLoading, mutate } = useApiSWR('/tenants');
//
// Voordeel boven directe `api.get(...)` in useEffect:
//   • Data is instant zichtbaar bij tabwissel (SWR cachet per key)
//   • Achtergrond-revalidate bij focus / reconnect (verse data zonder wachten)
//   • Automatisch deduping als meerdere componenten dezelfde URL fetchen
import useSWR, { mutate as globalMutate, preload as swrPreload, useSWRConfig } from 'swr';
import { useEffect, useRef, useMemo } from 'react';
import { api } from './api';

// Fetcher — SWR key = API path (bv. '/tenants'). Retourneert `data` uit
// de axios response zodat components direct `data` kunnen destructureren.
const fetcher = async (url) => {
  const r = await api.get(url);
  return r.data;
};

// Deep-equality compare via JSON zodat een refetch met identieke data
// geen re-render triggert. Voorkomt "tekst flikker" bij tabwissel wanneer
// de background-revalidate identieke bytes terugkrijgt.
const jsonCompare = (a, b) => {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
};

// Gedeelde default config — houd cache voor 60s (dedupingInterval), skip
// mount-revalidate wanneer data uit cache komt zodat er GEEN extra render
// gebeurt bij tabwissel. `compare` voorkomt re-render als revalidate
// dezelfde data teruggeeft.
const defaultConfig = {
  fetcher,
  revalidateOnFocus: false,      // was: true — te agressief, veroorzaakte flikker
  revalidateOnReconnect: true,
  revalidateIfStale: false,      // cache is goed genoeg tot expliciete mutate()
  revalidateOnMount: undefined,  // laat SWR zelf beslissen (skip als cache present)
  dedupingInterval: 60000,       // 60s (was 30s)
  focusThrottleInterval: 60000,
  keepPreviousData: true,        // vorige data blijft zichtbaar tijdens fetch
  errorRetryCount: 2,
  compare: jsonCompare,
};

export function useApiSWR(key, options) {
  // FLICKER-FIX: bij een fresh mount van een tab-component checkt de hook
  // eerst of SWR al data in de global cache heeft voor deze key. Zo ja,
  // gebruiken we die als `fallbackData` zodat de eerste render meteen data
  // toont i.p.v. eerst een skeleton en dán data (2 renders = "flash").
  const { cache } = useSWRConfig();
  const fallbackData = useMemo(() => {
    if (!key) return undefined;
    try {
      const entry = cache.get(key);
      return entry?.data;
    } catch { return undefined; }
  }, [key, cache]);
  const merged = { ...defaultConfig, fallbackData, ...(options || {}) };
  // BUG FIX: SWR treats `useSWR(key, undefined, config)` as "no fetcher"
  // (resolve-args uses args[1] when 3 args provided). Pass fetcher explicitly.
  return useSWR(key, merged.fetcher, merged);
}

// Handmatige cache-invalidatie — na een mutation (POST/DELETE) roep dit aan
// om SWR te forceren nieuw op te halen. Werkt met dezelfde key als useApiSWR.
export function invalidateSWR(key) {
  return globalMutate(key);
}

// ────────────────────────────────────────────────────────────────────
// Prefetching — vul de SWR cache proactief voor tab-content die de user
// binnenkort waarschijnlijk gaat openen. Zo is er GEEN loading-state of
// flikker bij de eerste tabwissel; data staat al klaar.
//
// Gebruik in AdminDashboard:
//    usePrefetchAdmin([
//      '/tenants', '/apartments', '/contracts', '/invoices',
//      '/payments', '/locations', '/deposits', '/kasgeld',
//      '/maintenance', '/employees', '/payment-plans?status=active',
//    ]);
//
// Prefetch triggert een fetch zonder React-subscription (rendert niets).
// Als een component later met dezelfde key een `useApiSWR` doet, is de
// data instant beschikbaar uit de cache — geen skeleton/empty state.
// ────────────────────────────────────────────────────────────────────
export function prefetchApi(key) {
  if (!key) return null;
  return swrPreload(key, fetcher);
}

/**
 * usePrefetchAdmin — batch-prefetch bij mount + refresh bij `deps`-wijzigingen.
 * Prefetches vuren IMMEDIATELY (niet requestIdleCallback) zodat de cache al
 * gevuld is voordat de gebruiker een tab aanklikt. Axios-calls zijn async
 * en blokkeren de paint niet, dus vroeg starten is puur winst.
 */
export function usePrefetchAdmin(keys, deps = []) {
  const doneRef = useRef(new Set());
  useEffect(() => {
    (keys || []).forEach((k) => {
      if (!k || doneRef.current.has(k)) return;
      doneRef.current.add(k);
      try { swrPreload(k, fetcher); }
      catch { /* niet-fataal — SWR faalt zelfstandig af */ }
    });
    // eslint-disable-next-line
  }, deps);
}
