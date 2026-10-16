import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Bluetooth, Printer, X } from 'lucide-react';
import { api } from '../lib/api';
import { getKioskLiveState, subscribeKioskLive } from '../lib/kiosk-live';
import { getSavedPrinter, useBtReady } from '../lib/bt-printer';
import { getLocalPaper, isKtpDevice } from '../lib/ktp-printer';

function useKtpOnline(enabled) {
  const liveState = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  const live = liveState.printers || [];
  const [fetched, setFetched] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    const load = () => api.get('/kiosk/printers/online').then(({ data }) => setFetched(data || [])).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [enabled]);
  return liveState.printersKnown || live.length ? live : fetched;
}

function useLocalPaper() {
  const [paper, setPaper] = useState(getLocalPaper);
  useEffect(() => {
    const on = (e) => setPaper(e.detail?.paper || getLocalPaper());
    window.addEventListener('ktp-paper-changed', on);
    return () => window.removeEventListener('ktp-paper-changed', on);
  }, []);
  return paper;
}

const PAPER_MSG = {
  low: { text: 'Papier bijna op — vervang binnenkort de rol', cls: 'bg-amber-50 border-amber-300 text-amber-800' },
  empty: { text: 'Papier leeg — vervang de rol', cls: 'bg-red-50 border-red-300 text-red-700' },
};

function Row({ icon: Icon, label, detail, ok, paper, testid }) {
  const warn = PAPER_MSG[paper];
  const dot = !ok ? 'bg-red-500' : paper === 'empty' ? 'bg-red-500' : paper === 'low' ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <li className="py-2.5" data-testid={testid} data-active={ok ? 'true' : 'false'} data-paper={paper || 'ok'}>
      <div className="flex items-center gap-3">
        <Icon className="w-4 h-4 text-slate-500" />
        <span className="flex-1 min-w-0"><span className="block text-sm font-bold text-slate-900">{label}</span>
          <span className="text-xs text-slate-500">{detail}</span></span>
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
      </div>
      {ok && warn && (
        <p className={`mt-2 flex items-center gap-2 text-xs font-bold border rounded-lg px-2.5 py-2 ${warn.cls}`} data-testid={`${testid}-paper-warning`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />{warn.text}
        </p>
      )}
    </li>
  );
}

// Eén lampje: groen als minstens één ingestelde bonprinter werkt, anders rood.
export function PrinterLamp({ className = '', testid = 'kiosk-printer-lamp' }) {
  const [open, setOpen] = useState(false);
  const mode = localStorage.getItem('kiosk_printer') || 'none';
  const bt = getSavedPrinter();
  const self = isKtpDevice();
  const wantKtp = mode === 'kt-v520' || self;
  const ktp = useKtpOnline(wantKtp && !self);
  const btReady = useBtReady();
  const localPaper = useLocalPaper();
  if (!wantKtp && !bt && mode !== 'bluetooth') return null;

  const ktpOk = self || ktp.length > 0;
  const rows = [];
  if (wantKtp && (self || !ktp.length)) rows.push({ key: 'ktp', icon: Printer, label: 'KT-V520', ok: ktpOk, paper: self ? localPaper : undefined,
    detail: self ? 'Ingebouwde printer van dit toestel' : 'Geen KT-V520 online' });
  else if (wantKtp) [...ktp].sort((a, b) => a.name.localeCompare(b.name)).forEach((p, i) => rows.push({ key: i ? `ktp-${i}` : 'ktp',
    icon: Printer, label: p.name, ok: true, paper: p.paper, detail: 'KT-V520 · online' }));
  if (bt || mode === 'bluetooth') rows.push({ key: 'bt', icon: Bluetooth, label: 'Bluetooth printer', ok: btReady,
    detail: !bt ? 'Nog geen printer gekoppeld op dit toestel' : btReady ? `${bt.name} verbonden` : `${bt.name} niet bereikbaar` });
  const on = rows.some((r) => r.ok);
  const okRows = rows.filter((r) => r.ok);
  // Rood als geen printer werkt of het papier van de enige werkende printer leeg is; oranje bij bijna op.
  const level = !on ? 'off' : okRows.every((r) => r.paper === 'empty') ? 'empty'
    : okRows.some((r) => r.paper === 'low' || r.paper === 'empty') ? 'low' : 'ok';
  const label = { off: 'Bonprinter niet verbonden', empty: 'Papier leeg', low: 'Papier bijna op', ok: 'Bonprinter verbonden' }[level];
  const lampCls = { off: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]', empty: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-pulse',
    low: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)] animate-pulse', ok: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]' }[level];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={label} aria-label={label} data-testid={testid}
        data-active={on ? 'true' : 'false'} data-level={level}
        className={`w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors relative ${className}`}>
        <Printer className="w-4 h-4" />
        <span className={`absolute right-1 bottom-1 w-2.5 h-2.5 rounded-full ring-2 ring-white/90 ${lampCls}`} />
      </button>
      {open && createPortal((
        <div className="fixed inset-0 z-[130] bg-black/40 flex items-start justify-end p-3" onClick={() => setOpen(false)} data-testid="kiosk-printer-lamp-panel">
          <div className="bg-white rounded-2xl w-full max-w-xs p-4 mt-12 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <p className="font-black text-slate-900">Bonprinter</p>
              <button onClick={() => setOpen(false)} data-testid="kiosk-printer-lamp-close" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => <Row key={r.key} {...r} testid={`kiosk-printer-lamp-${r.key}`} />)}
            </ul>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
