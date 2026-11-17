import { useEffect, useState } from 'react';
import { Signal } from 'lucide-react';

export const isSlowConnectionEstimate = (connection) =>
  ['slow-2g', '2g'].includes(connection?.effectiveType);

const netSlow = () =>
  typeof navigator !== 'undefined' && isSlowConnectionEstimate(navigator.connection);

export function SlowConnectionBanner() {
  const [slowNet, setSlowNet] = useState(netSlow);

  useEffect(() => {
    const onNet = () => setSlowNet(netSlow());
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    navigator.connection?.addEventListener?.('change', onNet);
    return () => {
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      navigator.connection?.removeEventListener?.('change', onNet);
    };
  }, []);

  if (!slowNet || navigator.onLine === false) return null;
  return (
    <div data-testid="slow-connection-banner" role="status" aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[2147482000] pointer-events-none flex items-center gap-2 bg-amber-400 text-amber-950 font-bold text-xs px-4 py-2 rounded-full shadow-[0_10px_25px_-8px_rgba(245,158,11,0.7)] animate-fade-in"
      style={{ bottom: 'max(calc(env(safe-area-inset-bottom) + 16px), 20px)', fontFamily: "'Outfit', system-ui, sans-serif" }}>
      <Signal className="w-4 h-4" strokeWidth={2.6} /> Trage verbinding
    </div>
  );
}
