import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Bluetooth, Printer, X } from 'lucide-react';
import { api } from '../lib/api';
import { getKioskLiveState, subscribeKioskLive } from '../lib/kiosk-live';
import { getSavedPrinter, useBtReady } from '../lib/bt-printer';
import { isKtpDevice } from '../lib/ktp-printer';

function useKtpOnline(enabled) {
  const live = useSyncExternalStore(subscribeKioskLive, getKioskLiveState).printers || [];
  const [fetched, setFetched] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    const load = () => api.get('/kiosk/printers/online').then(({ data }) => setFetched(data || [])).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [enabled]);
  return live.length ? live : fetched;
}

function Row({ icon: Icon, label, detail, ok, testid }) {
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid={testid} data-active={ok ? 'true' : 'false'}>
      <Icon className="w-4 h-4 text-slate-500" />
      <span className="flex-1 min-w-0"><span className="block text-sm font-bold text-slate-900">{label}</span>
        <span className="text-xs text-slate-500">{detail}</span></span>
      <span className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
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
  if (!wantKtp && !bt && mode !== 'bluetooth') return null;

  const ktpOk = self || ktp.length > 0;
  const rows = [];
  if (wantKtp) rows.push({ key: 'ktp', icon: Printer, label: 'KT-V520', ok: ktpOk,
    detail: self ? 'Ingebouwde printer van dit toestel' : ktpOk ? `${ktp[0].name} online` : 'Geen KT-V520 online' });
  if (bt || mode === 'bluetooth') rows.push({ key: 'bt', icon: Bluetooth, label: 'Bluetooth printer', ok: btReady,
    detail: !bt ? 'Nog geen printer gekoppeld op dit toestel' : btReady ? `${bt.name} verbonden` : `${bt.name} niet bereikbaar` });
  const on = rows.some((r) => r.ok);
  const label = on ? 'Bonprinter verbonden' : 'Bonprinter niet verbonden';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={label} aria-label={label} data-testid={testid}
        data-active={on ? 'true' : 'false'}
        className={`w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors relative ${className}`}>
        <Printer className="w-4 h-4" />
        <span className={`absolute right-1 bottom-1 w-2.5 h-2.5 rounded-full ring-2 ring-white/90 ${on ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]'}`} />
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
