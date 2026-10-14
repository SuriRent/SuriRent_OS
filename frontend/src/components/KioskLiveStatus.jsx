import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { Printer } from 'lucide-react';
import { subscribeKioskLive, getKioskLiveState, startKioskLive, stopKioskLive, setKioskOverlayOpen } from '../lib/kiosk-live';
import { KioskPrintsOverlay } from './KioskPrintsOverlay';
import { useApprovalNotifySync } from '../lib/approval-notify-sync';
import { ensurePrinterRegistered, isPairedPrinter, pairThisDevice } from '../lib/ktp-printer';
import { apkBridge } from '../lib/kiosk-print';

// Handmatig koppelen als KT-V520 (alleen beheerder, alleen in de APK, nog niet gekoppeld).
function KtpPairPill() {
  const [state, setState] = useState(() => (isPairedPrinter() ? 'done' : 'idle'));
  useEffect(() => {
    const onPaired = () => setState('done');
    window.addEventListener('ktp-paired', onPaired);
    return () => window.removeEventListener('ktp-paired', onPaired);
  }, []);
  if (!apkBridge() || state === 'done') return null;
  const pair = async () => {
    if (!window.confirm('Dit toestel koppelen als KT-V520 printer? Het print daarna bonnen die de beheerder op afstand stuurt, ook als niemand is ingelogd.')) return;
    setState('busy');
    try { const d = await pairThisDevice(); window.alert(`Gekoppeld als ${d.name}`); setState('done'); }
    catch (e) { window.alert(e?.response?.data?.detail || e?.message || 'Koppelen mislukt'); setState('idle'); }
  };
  return (
    <button type="button" onClick={pair} disabled={state === 'busy'} data-testid="kiosk-ktp-pair-btn"
      className="fixed z-[60] left-2 h-8 px-3 rounded-full bg-slate-900/85 text-white text-xs font-bold flex items-center gap-1.5 backdrop-blur disabled:opacity-60"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 6px)' }}>
      <Printer className="w-3.5 h-3.5" /> {state === 'busy' ? 'Koppelen…' : 'Koppel dit toestel als KT-V520'}
    </button>
  );
}

// Statusbolletje (alleen beheerder-kiosk) + bonnen-venster. Rendert los van
// de rest van de kiosk via een externe store.
function KioskLiveStatusInner({ isAdmin }) {
  useEffect(() => {
    startKioskLive(isAdmin ? 'admin' : 'employee');
    ensurePrinterRegistered();
    return () => stopKioskLive();
  }, [isAdmin]);
  const s = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  useApprovalNotifySync({ enabled: isAdmin });

  if (!isAdmin) return null;
  const label = s.active ? `${s.count} kiosk-medewerker${s.count === 1 ? '' : 's'} actief` : 'Geen kiosk-medewerker actief';
  return (
    <>
      <KtpPairPill />
      <button type="button" onClick={() => setKioskOverlayOpen(true)} title={label} aria-label={label}
        data-testid="kiosk-presence-dot" data-active={s.active ? 'true' : 'false'}
        className="fixed z-40 p-1.5" style={{ top: 'env(safe-area-inset-top, 0px)', right: 0 }}>
        <span className={`block w-3 h-3 rounded-full ring-2 ring-white/80 transition-colors duration-300 ${s.active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]' : 'bg-slate-400'}`} />
      </button>
      {s.overlayOpen && (
        <KioskPrintsOverlay employees={s.employees} printsVersion={s.printsVersion} onClose={() => setKioskOverlayOpen(false)} />
      )}
    </>
  );
}

export const KioskLiveStatus = memo(KioskLiveStatusInner);
