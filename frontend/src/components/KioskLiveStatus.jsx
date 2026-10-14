import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Bluetooth, MessageCircle, Printer, Receipt, X } from 'lucide-react';
import { BtPrinterCard } from './BtPrinterCard';
import { getSavedPrinter } from '../lib/bt-printer';
import { subscribeKioskLive, getKioskLiveState, startKioskLive, stopKioskLive, setKioskOverlayOpen } from '../lib/kiosk-live';
import { KioskPrintsOverlay } from './KioskPrintsOverlay';
import { KioskChat } from './KioskChat';
import { subscribeChat, getChatState, totalUnread, openChat, installKioskChat } from '../lib/kiosk-chat';
import { useApprovalNotifySync } from '../lib/approval-notify-sync';
import { ensurePrinterRegistered, isPairedPrinter, pairThisDevice } from '../lib/ktp-printer';
import { apkBridge } from '../lib/kiosk-print';

// Eén nette werkbalk rechtsboven: [printer] [chat] [status-bolletje].
const BTN = 'w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors';

function Toolbar({ children }) {
  return (
    <div className="hidden md:flex fixed z-40 right-2 items-center gap-0.5 h-10 px-1 rounded-full bg-black/25 backdrop-blur-md ring-1 ring-white/15 shadow-lg"
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

// Mobiel: chat, Bonnen van vandaag en KT-V520 koppelen in het "Snel toevoegen" menu.
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
  useEffect(() => { installKioskChat(isAdmin ? 'admin' : 'employee'); }, [isAdmin]);
  const s = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  const unread = totalUnread(useSyncExternalStore(subscribeChat, getChatState));
  const [paired, setPaired] = useState(isPairedPrinter);
  const on = isAdmin ? s.active : s.connected;
  const pill = 'relative h-11 rounded-full font-bold text-sm inline-flex items-center justify-center gap-2 bg-white text-[#FF5C00] shadow-sm active:scale-95 transition';
  const pair = async () => {
    if (!window.confirm('Dit toestel koppelen als KT-V520 printer? Het print daarna bonnen die de beheerder op afstand stuurt, ook als niemand is ingelogd.')) return;
    try { const d = await pairThisDevice(); window.alert(`Gekoppeld als ${d.name}`); setPaired(true); }
    catch (e) { window.alert(e?.response?.data?.detail || e?.message || 'Koppelen mislukt'); }
  };
  const showPair = isAdmin && !!apkBridge() && !paired;
  const [btOpen, setBtOpen] = useState(false);
  const showBt = (s.printer ?? localStorage.getItem('kiosk_printer')) === 'bluetooth';
  const cols = 2 + (showPair ? 1 : 0) + (showBt ? 1 : 0);
  return (
    <div className={`mt-3 grid gap-2 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'}`} data-testid="kiosk-sheet-live-actions">
      <button onClick={() => { onClose(); openChat(true); }} data-testid="kiosk-sheet-chat" className={pill}>
        <MessageCircle className="w-4 h-4" strokeWidth={2.5} /> Chat
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center" data-testid="kiosk-sheet-chat-unread">{unread}</span>}
      </button>
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
