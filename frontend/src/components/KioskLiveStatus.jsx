import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { Printer } from 'lucide-react';
import { subscribeKioskLive, getKioskLiveState, startKioskLive, stopKioskLive, setKioskOverlayOpen } from '../lib/kiosk-live';
import { KioskPrintsOverlay } from './KioskPrintsOverlay';
import { KioskChat } from './KioskChat';
import { useApprovalNotifySync } from '../lib/approval-notify-sync';
import { ensurePrinterRegistered, isPairedPrinter, pairThisDevice } from '../lib/ktp-printer';
import { apkBridge } from '../lib/kiosk-print';

// Eén nette werkbalk rechtsboven: [printer] [chat] [status-bolletje].
const BTN = 'w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors';

function Toolbar({ children }) {
  return (
    <div className="fixed z-40 right-2 flex items-center gap-0.5 h-10 px-1 rounded-full bg-black/25 backdrop-blur-md ring-1 ring-white/15 shadow-lg"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }} data-testid="kiosk-toolbar">
      {children}
    </div>
  );
}

function StatusDot({ on, label, testid, onClick }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} data-testid={testid} data-active={on ? 'true' : 'false'} className={BTN}>
      <span className={`block w-3 h-3 rounded-full ring-2 ring-white/80 transition-colors duration-300 ${on ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]' : 'bg-slate-400'}`} />
    </button>
  );
}

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
      title="Koppel dit toestel als KT-V520" aria-label="Koppel dit toestel als KT-V520"
      className={`${BTN} disabled:opacity-60`}>
      <Printer className={`w-4 h-4 ${state === 'busy' ? 'animate-pulse' : ''}`} />
    </button>
  );
}

// Statusbolletje (alleen beheerder-kiosk) + bonnen-venster. Rendert los van
// de rest van de kiosk via een externe store.
function KioskLiveStatusInner({ isAdmin, onHome = true }) {
  useEffect(() => {
    startKioskLive(isAdmin ? 'admin' : 'employee');
    ensurePrinterRegistered();
    return () => stopKioskLive();
  }, [isAdmin]);
  const s = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  useApprovalNotifySync({ enabled: isAdmin });

  const open = () => setKioskOverlayOpen(true);
  const dot = isAdmin
    ? <StatusDot on={s.active} onClick={open} testid="kiosk-presence-dot"
        label={s.active ? `${s.count} kiosk-medewerker${s.count === 1 ? '' : 's'} actief` : 'Geen kiosk-medewerker actief'} />
    : <StatusDot on={s.connected} onClick={open} testid="kiosk-employee-receipts-dot" label={s.connected ? 'Bonnen van vandaag' : 'Geen verbinding'} />;
  return (
    <>
      {onHome ? (
        <Toolbar>
          {isAdmin && <KtpPairPill />}
          <KioskChat role={isAdmin ? 'admin' : 'employee'} visible inline />
          {dot}
        </Toolbar>
      ) : <KioskChat role={isAdmin ? 'admin' : 'employee'} visible={false} />}
      {s.overlayOpen && (
        <KioskPrintsOverlay employees={isAdmin ? s.employees : []} printsVersion={s.printsVersion} employeeMode={!isAdmin}
          onClose={() => setKioskOverlayOpen(false)} />
      )}
    </>
  );
}

export const KioskLiveStatus = memo(KioskLiveStatusInner);
