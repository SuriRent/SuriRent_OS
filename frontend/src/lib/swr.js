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

// Gedeelde default config — houd cache voor 30s (dedupingInterval), maar
// revalidateOnFocus zodat data verse blijft wanneer gebruiker terugkomt.
const defaultConfig = {
  fetcher,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 30000,   // 30s: zelfde key wordt binnen 30s uit cache geserveerd
  keepPreviousData: true,    // toon oude data tijdens revalidate ipv loading state
  errorRetryCount: 2,
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
