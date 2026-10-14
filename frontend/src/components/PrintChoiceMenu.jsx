import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, Printer, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { subscribeKioskLive, getKioskLiveState } from '../lib/kiosk-live';

const TIMEOUT_MS = 20000;

function useOnlinePrinters(open) {
  const live = useSyncExternalStore(subscribeKioskLive, getKioskLiveState).printers;
  const [fetched, setFetched] = useState([]);
  useEffect(() => {
    if (!open) return;
    api.get('/kiosk/printers/online').then(({ data }) => setFetched(data || [])).catch(() => setFetched([]));
  }, [open]);
  return live.length ? live : fetched;
}

// Keuzemenu "Afdruk": via KT-V520 (WebSocket) of lokaal printvenster.
export function PrintChoiceMenu({ paymentId, disabled, onLocal, onStatus }) {
  const [pos, setPos] = useState(null);
  const [sending, setSending] = useState(false);
  const btnRef = useRef(null);
  const job = useRef(null);
  const timer = useRef(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const printers = useOnlinePrinters(!!pos);
  const first = printers[0];

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
      const { data } = await api.post(`/kiosk/print-log/by-payment/${paymentId}/remote-print`, { printer_id: first.id });
      job.current = data.job_id;
      timer.current = setTimeout(() => { job.current = null; setSending(false); onStatus({ kind: 'err', msg: `Geen antwoord van ${first.name}` }); }, TIMEOUT_MS);
    } catch (e) { setSending(false); onStatus({ kind: 'err', msg: e?.response?.data?.detail || 'Verzenden mislukt' }); }
  };

  const item = 'w-full text-left px-3 py-2.5 text-sm font-semibold flex items-center gap-2';
  return (
    <>
      <button ref={btnRef} data-testid={`history-print-${paymentId}`} onClick={toggle} disabled={disabled || sending}
        className="px-2.5 h-8 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold text-xs flex items-center gap-1">
        {disabled || sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
        Afdruk <ChevronDown className="w-3 h-3" />
      </button>
      {pos && createPortal((
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setPos(null)} data-testid={`history-print-menu-backdrop-${paymentId}`} />
          <div className="fixed z-[201] min-w-[220px] bg-white rounded-xl shadow-xl border border-slate-100 py-1" style={pos} data-testid={`history-print-menu-${paymentId}`}>
            <button onClick={sendKtp} disabled={!first} data-testid={`history-print-ktp-${paymentId}`}
              className={`${item} text-slate-800 hover:bg-orange-50 disabled:opacity-40 disabled:hover:bg-transparent`}>
              <Printer className="w-4 h-4 text-orange-500" />
              <span className="flex flex-col"><span>Print via KT-V520</span>
                <span className="text-[11px] font-medium text-slate-400" data-testid={`history-print-ktp-hint-${paymentId}`}>{first ? first.name : 'Geen KT-V520 online'}</span></span>
            </button>
            <button onClick={() => { setPos(null); onLocal(); }} data-testid={`history-print-local-${paymentId}`}
              className={`${item} text-slate-800 hover:bg-orange-50`}>
              <Smartphone className="w-4 h-4 text-slate-500" /> Afdrukken
            </button>
          </div>
        </>
      ), document.body)}
    </>
  );
}
