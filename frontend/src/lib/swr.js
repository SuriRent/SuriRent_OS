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
import useSWR, { mutate as globalMutate } from 'swr';
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
  // BUG FIX: SWR treats `useSWR(key, undefined, config)` as "no fetcher"
  // (resolve-args uses args[1] when 3 args provided). Pass fetcher explicitly.
  const merged = { ...defaultConfig, ...(options || {}) };
  return useSWR(key, merged.fetcher, merged);
}

// Handmatige cache-invalidatie — na een mutation (POST/DELETE) roep dit aan
// om SWR te forceren nieuw op te halen. Werkt met dezelfde key als useApiSWR.
export function invalidateSWR(key) {
  return globalMutate(key);
}
