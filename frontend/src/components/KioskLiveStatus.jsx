import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Bluetooth, Printer, Receipt, X } from 'lucide-react';
import { BtPrinterCard } from './BtPrinterCard';
import { getSavedPrinter } from '../lib/bt-printer';
import { subscribeKioskLive, getKioskLiveState, startKioskLive, stopKioskLive, setKioskOverlayOpen } from '../lib/kiosk-live';
import { KioskPrintsOverlay } from './KioskPrintsOverlay';
import { PrinterLamp } from './PrinterLamp';
import { useApprovalNotifySync } from '../lib/approval-notify-sync';
import { api } from '../lib/api';
import { ensurePrinterRegistered, isKtpDevice, isPairedPrinter, pairThisDevice } from '../lib/ktp-printer';

// Eén nette werkbalk rechtsboven: [printer] [status-bolletje].
const BTN = 'w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors';

function StatusDot({ on, label, testid, onClick, count }) {
  const hasCount = typeof count === 'number';
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} data-testid={testid} data-active={on ? 'true' : 'false'} className={BTN}>
      <span data-testid={hasCount ? 'kiosk-receipts-count' : undefined}
        className={`flex items-center justify-center rounded-full ring-2 ring-white/80 transition-colors duration-300 text-white font-black leading-none ${hasCount ? 'min-w-[22px] h-[22px] px-1 text-[11px]' : 'w-3 h-3'} ${on ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]' : 'bg-slate-400'}`}>
        {hasCount ? (count > 99 ? '99+' : count) : null}
      </span>
    </button>
  );
}

const todayStartIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

// Aantal bonnen van vandaag; ververst bij nieuwe prints en elke minuut.
function useTodayReceiptCount(version) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    const load = () => api.get('/kiosk/print-log/count', { params: { since: todayStartIso() } })
      .then(({ data }) => setCount(data.count)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [version]);
  return count;
}

// Handmatig koppelen als KT-V520 (alleen beheerder, alleen in de APK, nog niet gekoppeld).
function KtpPairPill() {
  const [state, setState] = useState(() => (isPairedPrinter() ? 'done' : 'idle'));
  useEffect(() => {
    const onPaired = () => setState('done');
    window.addEventListener('ktp-paired', onPaired);
    return () => window.removeEventListener('ktp-paired', onPaired);
  }, []);
  if (!isKtpDevice() || state === 'done') return null;
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
function KioskLiveStatusInner({ isAdmin }) {
  useEffect(() => {
    startKioskLive(isAdmin ? 'admin' : 'employee');
    ensurePrinterRegistered();
    return () => stopKioskLive();
  }, [isAdmin]);
  const s = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  useApprovalNotifySync({ enabled: isAdmin });

  return (
    <>
      {s.overlayOpen && (
        <KioskPrintsOverlay employees={isAdmin ? s.employees : []} printsVersion={s.printsVersion} employeeMode={!isAdmin}
          onClose={() => setKioskOverlayOpen(false)} />
      )}
    </>
  );
}

export const KioskLiveStatus = memo(KioskLiveStatusInner);

// Desktop-bovenbalk: [KT-V520 koppelen] [printerlampje] [status-bolletje → Bonnen van vandaag].
export function KioskHeaderLiveButtons({ isAdmin }) {
  const s = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  const count = useTodayReceiptCount(`${s.printsVersion}-${s.overlayOpen}`);
  const open = () => setKioskOverlayOpen(true);
  return (
    <div className="flex items-center gap-0.5 h-10 px-1 rounded-full bg-white/15" data-testid="kiosk-toolbar">
      {isAdmin && <KtpPairPill />}
      <PrinterLamp />
      {isAdmin
        ? <StatusDot on={s.active} onClick={open} testid="kiosk-presence-dot" count={count ?? undefined}
            label={`${count ?? 0} bonnen vandaag · ${s.active ? `${s.count} kiosk-medewerker${s.count === 1 ? '' : 's'} actief` : 'Geen kiosk-medewerker actief'}`} />
        : <StatusDot on={s.connected} onClick={open} testid="kiosk-employee-receipts-dot" count={count ?? undefined} label={s.connected ? `${count ?? 0} bonnen van vandaag` : 'Geen verbinding'} />}
    </div>
  );
}

// Mobiel: Bonnen van vandaag en KT-V520 koppelen in het "Snel toevoegen" menu.
function BtPrinterDialog({ onClose }) {
  return createPortal((
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={onClose} data-testid="kiosk-bt-dialog">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-black text-slate-900 flex items-center gap-2"><Bluetooth className="w-5 h-5 text-blue-600" /> Bluetooth printer</p>
          <button onClick={onClose} data-testid="kiosk-bt-dialog-close" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center"><X className="w-5 h-5" /></button>
        </div>
        <BtPrinterCard />
      </div>
    </div>
  ), document.body);
}

export function KioskSheetLiveActions({ isAdmin, onClose }) {
  const s = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  const [paired, setPaired] = useState(isPairedPrinter);
  const on = isAdmin ? s.active : s.connected;
  const pill = 'relative h-11 rounded-full font-bold text-sm inline-flex items-center justify-center gap-2 bg-white text-[#FF5C00] shadow-sm active:scale-95 transition';
  const pair = async () => {
    if (!window.confirm('Dit toestel koppelen als KT-V520 printer? Het print daarna bonnen die de beheerder op afstand stuurt, ook als niemand is ingelogd.')) return;
    try { const d = await pairThisDevice(); window.alert(`Gekoppeld als ${d.name}`); setPaired(true); }
    catch (e) { window.alert(e?.response?.data?.detail || e?.message || 'Koppelen mislukt'); }
  };
  const showPair = isAdmin && isKtpDevice() && !paired;
  const [btOpen, setBtOpen] = useState(false);
  const showBt = (s.printer ?? localStorage.getItem('kiosk_printer')) === 'bluetooth';
  const cols = 1 + (showPair ? 1 : 0) + (showBt ? 1 : 0);
  return (
    <div className={`mt-3 grid gap-2 ${cols === 3 ? 'grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`} data-testid="kiosk-sheet-live-actions">
      <button onClick={() => { onClose(); setKioskOverlayOpen(true); }} data-testid="kiosk-sheet-receipts" className={pill}>
        <span className={`w-2.5 h-2.5 rounded-full ${on ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]' : 'bg-slate-300'}`} />
        <Receipt className="w-4 h-4" strokeWidth={2.5} /> Bonnen
      </button>
      {showPair && (
        <button onClick={pair} data-testid="kiosk-sheet-ktp-pair" className={pill} aria-label="Koppel dit toestel als KT-V520">
          <Printer className="w-4 h-4" strokeWidth={2.5} /> KT-V520
        </button>
      )}
      {showBt && (
        <button onClick={() => setBtOpen(true)} data-testid="kiosk-sheet-bt-printer" className={pill}>
          <Bluetooth className="w-4 h-4" strokeWidth={2.5} /> {getSavedPrinter() ? 'Printer' : 'Koppel printer'}
        </button>
      )}
      {btOpen && <BtPrinterDialog onClose={() => setBtOpen(false)} />}
    </div>
  );
}
