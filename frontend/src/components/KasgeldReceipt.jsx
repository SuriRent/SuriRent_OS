import { useEffect, useRef, useState } from 'react';
import { Bluetooth, CheckCircle2, Loader2, Printer, Wifi } from 'lucide-react';
import { api, fmtMoney } from '../lib/api';
import { apkBridge, apkPrintMessage } from '../lib/kiosk-print';
import { printLinesBluetooth } from '../lib/bt-printer';
import { usePrintOptions } from './PrintChoiceMenu';
import { trackKtpJob } from './KtpPrintToast';

const base = () => process.env.REACT_APP_BACKEND_URL || window.location.origin;

// Print-acties voor een kasgeld-bon: automatisch één keer naar alle actieve printers, plus handmatig opnieuw.
function useKasgeldPrint(entryId) {
  const { builtIn, others, bt } = usePrintOptions(true);
  const [status, setStatus] = useState({});
  const set = (k, v) => setStatus((s) => ({ ...s, [k]: v }));

  const printKtp = async () => {
    if (!others.length) return;
    set('ktp', 'sending');
    const res = await Promise.allSettled(others.map(async (p) => {
      const { data } = await api.post(`/kiosk/kasgeld/${entryId}/remote-print`, { printer_id: p.id });
      trackKtpJob(data.job_id, p.name);
    }));
    set('ktp', res.some((r) => r.status === 'fulfilled') ? 'done' : 'error');
  };
  const printBt = async () => {
    if (!bt) return;
    set('bt', 'sending');
    try {
      const { data } = await api.get(`/kiosk/kasgeld/${entryId}/print-data`);
      await printLinesBluetooth(data.lines || []);
      set('bt', 'done');
    } catch { set('bt', 'error'); }
  };
  const printBuiltIn = async () => {
    const bridge = apkBridge();
    if (!builtIn || !bridge) return;
    set('builtin', 'sending');
    try {
      const { data } = await api.get(`/kiosk/kasgeld/${entryId}/print-data`);
      bridge(JSON.stringify(apkPrintMessage(`${base()}/api/kiosk/kasgeld/${entryId}/receipt.png`, { ...data, printer: 'kt-v520' })));
      set('builtin', 'done');
    } catch { set('builtin', 'error'); }
  };
  return { builtIn, others, bt, status, printKtp, printBt, printBuiltIn };
}

function PrintBtn({ testId, icon: Icon, label, state, onClick, className }) {
  return (
    <button type="button" onClick={onClick} disabled={state === 'sending'} data-testid={testId}
      className={`flex-1 min-w-0 h-11 px-3 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform disabled:opacity-60 ${className}`}>
      {state === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : state === 'done' ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
      {label}
    </button>
  );
}

export function KasgeldReceiptScreen({ entry, onDone }) {
  const p = useKasgeldPrint(entry.id);
  const [img, setImg] = useState(null);
  const auto = useRef({});

  useEffect(() => {
    let url;
    api.get(`/kiosk/kasgeld/${entry.id}/receipt.png`, { responseType: 'blob' })
      .then((r) => { url = URL.createObjectURL(r.data); setImg(url); }).catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [entry.id]);

  // Automatisch printen zodra een printer bekend is — per printersoort één keer.
  useEffect(() => {
    if (p.builtIn && !auto.current.builtin) { auto.current.builtin = true; p.printBuiltIn(); }
    if (p.others.length && !auto.current.ktp) { auto.current.ktp = true; p.printKtp(); }
    if (p.bt && !auto.current.bt) { auto.current.bt = true; p.printBt(); }
  }, [p.builtIn, p.others.length, p.bt]);

  const isIn = entry.type === 'in';
  return (
    <div className="flex flex-col items-center text-center gap-4" data-testid="kasgeld-receipt-screen">
      <CheckCircle2 className="w-14 h-14 text-emerald-500" />
      <div>
        <p className="text-lg font-black text-slate-900">Mutatie opgeslagen</p>
        <p className={`text-2xl font-black ${isIn ? 'text-emerald-600' : 'text-red-600'}`} data-testid="kasgeld-receipt-amount">
          {isIn ? '+' : '−'} {fmtMoney(entry.amount, entry.currency)}
        </p>
        <p className="text-xs text-slate-500">{isIn ? 'Inleg' : 'Opname'}{entry.description ? ` · ${entry.description}` : ''}</p>
      </div>
      <div className="w-full max-h-[38vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2" data-testid="kasgeld-receipt-preview">
        {img ? <img src={img} alt="Kasgeld bon" className="mx-auto w-full max-w-[240px]" /> : <Loader2 className="w-5 h-5 animate-spin mx-auto my-6 text-slate-400" />}
      </div>
      <div className="w-full flex gap-2">
        {p.builtIn && <PrintBtn testId="kasgeld-print-builtin" icon={Printer} label="Ingebouwd" state={p.status.builtin}
          onClick={p.printBuiltIn} className="bg-[#FF5C00] hover:bg-[#E05200]" />}
        {p.others.length > 0 && <PrintBtn testId="kasgeld-print-ktp" icon={Wifi} label="KT-V520" state={p.status.ktp}
          onClick={p.printKtp} className="bg-slate-800 hover:bg-slate-900" />}
        {p.bt && <PrintBtn testId="kasgeld-print-bt" icon={Bluetooth} label="Bluetooth" state={p.status.bt}
          onClick={p.printBt} className="bg-blue-600 hover:bg-blue-700" />}
      </div>
      {!p.builtIn && !p.others.length && !p.bt && (
        <p className="text-xs text-slate-500" data-testid="kasgeld-print-none">Geen printer actief</p>
      )}
      <button type="button" onClick={onDone} data-testid="kasgeld-receipt-done"
        className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold active:scale-95 transition-transform">
        Klaar
      </button>
    </div>
  );
}
