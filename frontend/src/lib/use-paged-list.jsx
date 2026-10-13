import { useCallback, useEffect, useRef, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { Loader2 } from 'lucide-react';
import { api } from './api';
import { registerInfiniteRefresh } from './admin-events';

const fetcher = async (url) => (await api.get(url)).data;

// Gepagineerde lijst ({items,total,has_more,summary}) met 30 s cache en live-sync.
export function usePagedList(path, params, { pageSize = 25, liveKey } = {}) {
  const qs = new URLSearchParams(params).toString();
  const getKey = (i, prev) => (prev && !prev.has_more ? null
    : `${path}?${qs}${qs ? '&' : ''}offset=${i * pageSize}&limit=${pageSize}`);
  const { data: pages, size, setSize, mutate, isLoading, isValidating } = useSWRInfinite(getKey, fetcher, {
    revalidateFirstPage: false, revalidateOnFocus: false, revalidateIfStale: true,
    dedupingInterval: 30000, keepPreviousData: true,
  });
  useEffect(() => registerInfiniteRefresh(liveKey || path, () => mutate()), [liveKey, path, mutate]);
  const hasMore = !!pages?.[pages.length - 1]?.has_more;
  const loadingMore = isValidating && size > (pages?.length || 0);
  const loadMore = useCallback(() => { if (!isValidating) setSize((n) => n + 1); }, [isValidating, setSize]);
  return {
    items: (pages || []).flatMap((p) => p.items || []),
    pages,
    summary: pages?.[0]?.summary,
    total: pages?.[0]?.total ?? 0,
    hasMore, loadingMore, loadMore,
    loading: isLoading && !pages,
    refetch: mutate,
  };
}

// Laadt de volgende pagina zodra het einde van de lijst in beeld komt.
export function LoadMoreSentinel({ active, onVisible, testid }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active || !ref.current) return undefined;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) onVisible(); }, { rootMargin: '400px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [active, onVisible]);
  return (
    <div ref={ref} data-testid={testid} className="py-3 flex justify-center">
      {active && <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />}
    </div>
  );
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
