import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';

// Globaal offline-scherm (beheerder, kiosk, huurder; web, PWA, APK).
// navigator.onLine is onbetrouwbaar → altijd bevestigen met een echte ping.
const PING_URL = `${process.env.REACT_APP_BACKEND_URL}/api/health`;
const POLL_MS = 5000;

async function ping() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    // Unieke query → nooit uit de service-worker cache.
    const r = await fetch(`${PING_URL}?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}

export function OfflineOverlay() {
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reconnected, setReconnected] = useState(false);
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setChecking(true);
    const ok = await ping();
    busy.current = false; setChecking(false);
    setOffline((was) => {
      if (was && ok) {
        window.dispatchEvent(new CustomEvent('surirent:refresh')); // data verversen na herstel
        setReconnected(true);
      }
      return !ok;
    });
  }, []);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', check);
    window.addEventListener('surirent:network-error', check);
    if (navigator.onLine === false) setOffline(true);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', check);
      window.removeEventListener('surirent:network-error', check);
    };
  }, [check]);

  // Zolang offline: elke 5 s opnieuw proberen, scherm verdwijnt vanzelf.
  useEffect(() => {
    if (!offline) return undefined;
    const id = setInterval(check, POLL_MS);
    return () => clearInterval(id);
  }, [offline, check]);

  // "Weer verbonden" kort tonen.
  useEffect(() => {
    if (!reconnected) return undefined;
    const t = setTimeout(() => setReconnected(false), 3000);
    return () => clearTimeout(t);
  }, [reconnected]);

  if (!offline) {
    if (!reconnected) return null;
    return (
      <div data-testid="online-toast" role="status" aria-live="polite"
        className="fixed left-1/2 -translate-x-1/2 z-[2147483000] flex items-center gap-2.5 bg-emerald-500 text-white font-bold text-sm px-5 py-3 rounded-full shadow-[0_12px_30px_-8px_rgba(16,185,129,0.6)] animate-fade-in"
        style={{ top: 'max(calc(env(safe-area-inset-top) + 12px), 16px)', fontFamily: "'Outfit', system-ui, sans-serif" }}>
        <Wifi className="w-5 h-5" strokeWidth={2.4} /> Weer verbonden
      </div>
    );
  }
  return (
    <div data-testid="offline-overlay" role="alertdialog" aria-live="assertive"
      className="fixed inset-0 z-[2147483000] bg-[#FF5C00] text-white flex items-center justify-center text-center px-6"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 24px)', paddingBottom: 'max(env(safe-area-inset-bottom), 24px)', fontFamily: "'Outfit', system-ui, sans-serif" }}>
      <div className="w-full max-w-[420px] rounded-[28px] px-7 py-9 bg-white/10 border border-white/20 backdrop-blur-md shadow-[0_20px_50px_-15px_rgba(0,0,0,0.3)] animate-[fadeIn_.25s_ease-out]">
        <div className="w-24 h-24 mx-auto mb-5 rounded-full bg-white/15 flex items-center justify-center">
          <WifiOff className="w-14 h-14" strokeWidth={1.8} />
        </div>
        <h1 className="text-[clamp(22px,6vw,30px)] font-extrabold tracking-tight mb-2.5">Je bent offline</h1>
        <p className="text-[clamp(14px,3.6vw,16px)] font-medium opacity-95 leading-relaxed mb-6">
          SuriRent heeft geen internetverbinding. Controleer je WiFi of mobiel data en probeer het opnieuw.
        </p>
        <button type="button" onClick={check} disabled={checking} data-testid="offline-overlay-retry"
          className="w-full h-[52px] rounded-2xl bg-white text-[#FF5C00] font-extrabold text-[15px] flex items-center justify-center gap-2.5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.25)] active:scale-[0.97] transition-transform disabled:opacity-90">
          <RefreshCw className={`w-5 h-5 ${checking ? 'animate-spin' : ''}`} /> Probeer opnieuw
        </button>
        <div className="mt-3.5 inline-flex gap-1.5" aria-hidden="true">
          {[0, 0.2, 0.4].map((d) => (
            <span key={d} className="w-2 h-2 rounded-full bg-white/60 animate-pulse" style={{ animationDelay: `${d}s` }} />
          ))}
        </div>
        <p className="mt-7 mb-0 text-[11px] tracking-[0.24em] uppercase opacity-75 font-extrabold">SuriRent</p>
      </div>
    </div>
  );
}
