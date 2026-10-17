import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Bluetooth, ChevronDown, Loader2, Printer, Smartphone } from 'lucide-react';
import { getSavedPrinter, printLinesBluetooth, useBtReady } from '../lib/bt-printer';
import { api } from '../lib/api';
import { isKtpDevice } from '../lib/ktp-printer';
import { subscribeKioskLive, getKioskLiveState } from '../lib/kiosk-live';

const TIMEOUT_MS = 20000;

// Gedeelde cache: veel menu's in één lijst → één request per 15s.
let printersReq = null;
let printersAt = 0;
const fetchOnline = () => {
  if (!printersReq || Date.now() - printersAt > 15000) {
    printersAt = Date.now();
    printersReq = api.get('/kiosk/printers/online').then(({ data }) => data || []).catch(() => []);
  }
  return printersReq;
};

function useOnlinePrinters(open) {
  const liveState = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  const live = liveState.printers || [];
  const [fetched, setFetched] = useState([]);
  useEffect(() => {
    let alive = true;
    fetchOnline().then((d) => alive && setFetched(d));
    return () => { alive = false; };
  }, [open]);
  return liveState.printersKnown || live.length ? live : fetched;
}

// Keuzemenu "Afdruk": via KT-V520 (WebSocket) of lokaal printvenster.
export function PrintChoiceMenu({ paymentId, disabled, onLocal, onStatus, remoteUrl, printDataUrl, showLabel = false }) {
  const remotePath = remoteUrl || `/kiosk/print-log/by-payment/${paymentId}/remote-print`;
  const dataPath = printDataUrl || `/kiosk/payments/${paymentId}/print-data`;
  const [pos, setPos] = useState(null);
  const [sending, setSending] = useState(false);
  const btnRef = useRef(null);
  const job = useRef(null);
  const timer = useRef(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const printers = useOnlinePrinters(!!pos);
  const first = printers[0];
  const btReady = useBtReady();
  const bt = btReady ? getSavedPrinter() : null;
  // Ingebouwde printer alleen op een echte KT-V520; elders alleen KT-V520 (WS) en Bluetooth.
  const builtIn = isKtpDevice();

  useEffect(() => {
    const onDone = (e) => {
      if (!job.current || e.detail?.job_id !== job.current) return;
      clearTimeout(timer.current); job.current = null; setSending(false);
      statusRef.current(e.detail.ok ? { kind: 'ok', msg: `Geprint op ${e.detail.printer || 'KT-V520'}` } : { kind: 'err', msg: e.detail.error || 'Printen mislukt' });
    };
    window.addEventListener('ktp-remote-print-done', onDone);
    return () => { window.removeEventListener('ktp-remote-print-done', onDone); clearTimeout(timer.current); };
  }, []);

  useEffect(() => {
    if (!pos) return undefined;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [pos]);

  const toggle = () => {
    if (pos) { setPos(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 120;
    setPos({ right: window.innerWidth - r.right, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
  };

  const sendKtp = async () => {
    setPos(null); setSending(true); onStatus({ kind: 'sending', msg: `Verzonden naar ${first.name}…` });
    try {
      const { data } = await api.post(remotePath, { printer_id: first.id });
      job.current = data.job_id;
      timer.current = setTimeout(() => { job.current = null; setSending(false); onStatus({ kind: 'err', msg: `Geen antwoord van ${first.name}` }); }, TIMEOUT_MS);
    } catch (e) { setSending(false); onStatus({ kind: 'err', msg: e?.response?.data?.detail || 'Verzenden mislukt' }); }
  };

  const sendBt = async () => {
    setPos(null); setSending(true); onStatus({ kind: 'sending', msg: `Verzonden naar ${bt.name}…` });
    try {
      const { data } = await api.get(dataPath);
      await printLinesBluetooth(data.lines || []);
      onStatus({ kind: 'ok', msg: `Geprint op ${bt.name}` });
    } catch (e) { onStatus({ kind: 'err', msg: e?.message || 'Bluetooth printen mislukt' }); }
    finally { setSending(false); }
  };

  const item = 'w-full text-left px-3 py-2.5 text-sm font-semibold flex items-center gap-2';
  if (!builtIn && !first && !bt && !sending) return null;
  return (
    <>
      <button ref={btnRef} data-testid={`history-print-${paymentId}`} onClick={toggle} disabled={disabled || sending}
        aria-label="Afdruk"
        className={showLabel
          ? 'shrink-0 whitespace-nowrap px-3 h-10 rounded-xl bg-orange-500 hover:bg-orange-600 active:scale-95 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-transform'
          : 'w-9 h-9 sm:w-auto sm:h-8 sm:px-2.5 rounded-full sm:rounded-lg bg-orange-500 hover:bg-orange-600 active:scale-95 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-1 transition-transform'}>
        {disabled || sending ? <Loader2 className="w-4 h-4 sm:w-3 sm:h-3 animate-spin" /> : <Printer className="w-4 h-4 sm:w-3 sm:h-3" />}
        <span className={showLabel ? '' : 'hidden sm:inline'}>{showLabel ? 'Bon printen' : 'Afdruk'}</span> <ChevronDown className={`${showLabel ? '' : 'hidden sm:block'} w-3 h-3`} />
      </button>
      {pos && createPortal((
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setPos(null)} data-testid={`history-print-menu-backdrop-${paymentId}`} />
          <div className="fixed z-[201] min-w-[220px] bg-white rounded-xl shadow-xl border border-slate-100 py-1" style={pos} data-testid={`history-print-menu-${paymentId}`}>
            {first && (
              <button onClick={sendKtp} data-testid={`history-print-ktp-${paymentId}`}
                className={`${item} text-slate-800 hover:bg-orange-50`}>
                <Printer className="w-4 h-4 text-orange-500" />
                <span className="flex flex-col"><span>Print via KT-V520</span>
                  <span className="text-[11px] font-medium text-slate-400" data-testid={`history-print-ktp-hint-${paymentId}`}>{first.name}</span></span>
              </button>
            )}
            {bt && (
              <button onClick={sendBt} data-testid={`history-print-bt-${paymentId}`}
                className={`${item} text-slate-800 hover:bg-orange-50`}>
                <Bluetooth className="w-4 h-4 text-blue-600" />
                <span className="flex flex-col"><span>Print via Bluetooth</span>
                  <span className="text-[11px] font-medium text-slate-400">{bt.name}</span></span>
              </button>
            )}
            {builtIn && (
              <button onClick={() => { setPos(null); onLocal(); }} data-testid={`history-print-local-${paymentId}`}
                className={`${item} text-slate-800 hover:bg-orange-50`}>
                <Smartphone className="w-4 h-4 text-slate-500" /> Ingebouwde printer
              </button>
            )}
          </div>
        </>
      ), document.body)}
    </>
  );
}
