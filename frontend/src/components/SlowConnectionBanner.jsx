import { useEffect, useState } from 'react';
import { Signal } from 'lucide-react';

// Kleine gele melding bij erg trage verbinding. Signalen: Network Information
// API (waar beschikbaar) + gemiddelde duur van de laatste API-calls.
const SLOW_MS = 3000;
const FAST_MS = 1200;
const WINDOW = 4;

const netSlow = () => {
  const c = navigator.connection;
  if (!c) return false;
  return ['slow-2g', '2g'].includes(c.effectiveType) || (c.rtt && c.rtt >= 1500) || (c.downlink && c.downlink < 0.3);
};

export function SlowConnectionBanner() {
  const [slowApi, setSlowApi] = useState(false);
  const [slowNet, setSlowNet] = useState(netSlow);

  useEffect(() => {
    const samples = [];
    let idle;
    const onTime = (e) => {
      // Geen nieuwe metingen binnen 20 s → melding weg (niet blijven hangen).
      clearTimeout(idle);
      idle = setTimeout(() => { samples.length = 0; setSlowApi(false); }, 20000);
      samples.push(e.detail);
      if (samples.length > WINDOW) samples.shift();
      if (samples.length < 2) return;
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      // Hysterese: pas weer "snel" onder FAST_MS, zodat de melding niet knippert.
      setSlowApi((was) => (was ? avg > FAST_MS : avg > SLOW_MS));
    };
    const onNet = () => setSlowNet(netSlow());
    window.addEventListener('surirent:req-time', onTime);
    navigator.connection?.addEventListener?.('change', onNet);
    return () => {
      clearTimeout(idle);
      window.removeEventListener('surirent:req-time', onTime);
      navigator.connection?.removeEventListener?.('change', onNet);
    };
  }, []);

  if (!(slowApi || slowNet) || navigator.onLine === false) return null;
  return (
    <div data-testid="slow-connection-banner" role="status" aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[2147482000] pointer-events-none flex items-center gap-2 bg-amber-400 text-amber-950 font-bold text-xs px-4 py-2 rounded-full shadow-[0_10px_25px_-8px_rgba(245,158,11,0.7)] animate-fade-in"
      style={{ bottom: 'max(calc(env(safe-area-inset-bottom) + 16px), 20px)', fontFamily: "'Outfit', system-ui, sans-serif" }}>
      <Signal className="w-4 h-4" strokeWidth={2.6} /> Trage verbinding
    </div>
  );
}
