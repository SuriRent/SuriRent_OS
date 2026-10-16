import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Check, ChevronDown, Loader2, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { subscribeKioskLive, getKioskLiveState } from '../lib/kiosk-live';

const TIMEOUT_MS = 20000;

// "Print via KT-V520": stuurt de bon via de WebSocket naar een gekoppelde KT-V520.
// autoSend: stuur één keer automatisch naar de eerste online KT-V520.
export function KtpPrintButton({ log, onPrinted, fetchPrinters = false, autoSend = false }) {
  const liveState = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  const live = liveState.printers || [];
  const [fetched, setFetched] = useState([]);
  useEffect(() => {
    if (!fetchPrinters) return undefined;
    // Medewerker-kiosk krijgt geen presence-lijst via de WS → zelf ophalen.
    const load = () => api.get('/kiosk/printers/online').then(({ data }) => setFetched(data || [])).catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [fetchPrinters]);
  const printers = liveState.printersKnown || live.length ? live : fetched;
  const [status, setStatus] = useState(null); // sending | done | error
  const [msg, setMsg] = useState('');
  const [menu, setMenu] = useState(false);
  const job = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    const onDone = (e) => {
      if (!job.current || e.detail?.job_id !== job.current) return;
      clearTimeout(timer.current); job.current = null;
      if (e.detail.ok) { setStatus('done'); setMsg(`Geprint op ${e.detail.printer}`); onPrinted(); }
      else { setStatus('error'); setMsg(e.detail.error || 'Printen mislukt'); }
    };
    window.addEventListener('ktp-remote-print-done', onDone);
    return () => { window.removeEventListener('ktp-remote-print-done', onDone); clearTimeout(timer.current); };
  }, [onPrinted]);

  const send = async (printer) => {
    clearTimeout(timer.current); setMenu(false); setStatus('sending'); setMsg('Verzonden…');
    try {
      const { data } = await api.post(`/kiosk/print-log/by-payment/${log.payment_id}/remote-print`, { printer_id: printer.id });
      job.current = data.job_id;
      timer.current = setTimeout(() => { job.current = null; setStatus('error'); setMsg(`Geen antwoord van ${printer.name}`); }, TIMEOUT_MS);
    } catch (e) { setStatus('error'); setMsg(e?.response?.data?.detail || 'Verzenden mislukt'); }
  };

  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoSend || autoDone.current || !printers.length) return;
    autoDone.current = true;
    send(printers[0]);
  }, [autoSend, printers]);

  const none = !printers.length;
  // Alleen tonen als er echt een KT-V520 online is.
  if (none && status !== 'sending') return null;
  const onClick = () => (printers.length === 1 ? send(printers[0]) : setMenu((m) => !m));
  return (
    <div className="relative flex-1 sm:flex-none">
      <button onClick={onClick} disabled={none} data-testid={`kiosk-print-log-ktp-${log.id}`}
        title={none ? 'Geen KT-V520 online' : 'Print via KT-V520'}
        className="w-full h-10 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-40 transition-colors">
        {status === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : status === 'done' ? <Check className="w-4 h-4 text-emerald-400" /> : <Printer className="w-4 h-4" />}
        <span className="whitespace-nowrap">Print via KT-V520</span>
        {printers.length > 1 && <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {menu && (
        <div className="absolute right-0 top-11 z-20 min-w-[200px] bg-white rounded-xl shadow-xl border border-slate-100 py-1" data-testid={`kiosk-print-log-ktp-menu-${log.id}`}>
          {printers.map((p) => (
            <button key={p.id} onClick={() => send(p)} data-testid={`kiosk-print-log-ktp-pick-${p.id}`}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-orange-50 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />{p.name}
            </button>
          ))}
        </div>
      )}
      {status && status !== 'sending' && (
        <p className={`mt-1 text-[11px] font-bold flex items-center gap-1 ${status === 'done' ? 'text-emerald-600' : 'text-red-500'}`} data-testid={`kiosk-print-log-ktp-status-${log.id}`}>
          {status === 'error' && <AlertCircle className="w-3 h-3" />}{msg}
        </p>
      )}
    </div>
  );
}
