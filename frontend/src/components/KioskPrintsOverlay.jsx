import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Loader2, Printer, Receipt, UserRound, X } from 'lucide-react';
import { api, fmtMoney } from '../lib/api';
import { printReceipt } from '../lib/kiosk-print';

const todayStartIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

function EmployeePicker({ employees, onPick }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="kiosk-prints-employee-picker">
      {employees.map((e) => (
        <button key={e.key} onClick={() => onPick(e)} data-testid={`kiosk-prints-employee-${e.key}`}
          className="bg-white rounded-2xl p-5 flex items-center gap-4 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-transform text-left">
          <span className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center"><UserRound className="w-6 h-6" /></span>
          <span className="font-bold text-slate-900 text-lg">{e.name}</span>
        </button>
      ))}
    </div>
  );
}

function ReceiptRow({ log, onPrint, busy }) {
  const p = log.payment;
  const done = !!log.admin_printed_at;
  return (
    <div className="bg-white rounded-2xl px-4 py-3 flex items-center gap-4 shadow" data-testid={`kiosk-print-log-${log.id}`}>
      <Receipt className="w-5 h-5 text-[#FF5C00] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-slate-900 truncate">{p.tenant_name || 'Huurder'} <span className="text-slate-400 font-medium">· {p.receipt_number}</span></p>
        <p className="text-xs text-slate-500">Geprint om {fmtTime(log.printed_at)}</p>
      </div>
      <span className="font-black text-slate-900 whitespace-nowrap">{fmtMoney(p.amount, p.currency)}</span>
      {done && (
        <span className="flex items-center gap-1 text-emerald-600 text-xs font-bold whitespace-nowrap" data-testid={`kiosk-print-log-done-${log.id}`}>
          <Check className="w-4 h-4" /> Afgedrukt
        </span>
      )}
      <button onClick={() => onPrint(log)} disabled={busy} data-testid={`kiosk-print-log-print-${log.id}`}
        className="h-10 px-4 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold text-sm flex items-center gap-2 disabled:opacity-60 transition-colors">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Afdrukken
      </button>
    </div>
  );
}

export function KioskPrintsOverlay({ employees, printsVersion, onClose }) {
  const [picked, setPicked] = useState(null);
  const [logs, setLogs] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const emp = picked || (employees.length === 1 ? employees[0] : null);

  const load = useCallback(async () => {
    if (!emp) return;
    try {
      const { data } = await api.get('/kiosk/print-log', { params: { since: todayStartIso(), employee: emp.key } });
      setLogs(data);
    } catch { setLogs((l) => l || []); }
  }, [emp?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLogs(null); load(); }, [emp?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (printsVersion) load(); }, [printsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPrint = async (log) => {
    setBusyId(log.id);
    try {
      await printReceipt({ paymentId: log.payment_id, apiGet: api.get, relay: false });
      await api.post(`/kiosk/print-log/${log.id}/printed`);
      setLogs((ls) => ls.map((l) => (l.id === log.id ? { ...l, admin_printed_at: new Date().toISOString() } : l)));
    } catch { /* print-dialoog geannuleerd of netwerkfout */ }
    finally { setBusyId(null); }
  };

  return createPortal((
    <div className="fixed inset-0 z-[10000] bg-slate-900/95 backdrop-blur-md flex flex-col" data-testid="kiosk-prints-overlay"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center gap-3 px-5 py-4 text-white">
        {picked && employees.length > 1 && (
          <button onClick={() => setPicked(null)} data-testid="kiosk-prints-back" className="h-10 px-3 rounded-xl bg-white/10 hover:bg-white/20 flex items-center gap-1.5 text-sm font-bold">
            <ArrowLeft className="w-4 h-4" /> Medewerkers
          </button>
        )}
        <div className="flex-1">
          <p className="text-xs uppercase tracking-widest text-emerald-400 font-bold">Bonnen van vandaag</p>
          <p className="text-xl font-black">{emp ? emp.name : 'Kies een medewerker'}</p>
        </div>
        <button onClick={onClose} data-testid="kiosk-prints-close" className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-3">
        {!emp && employees.length === 0 && <p className="text-white/60 text-center mt-20" data-testid="kiosk-prints-empty">Geen kiosk-medewerker actief.</p>}
        {!emp && employees.length > 1 && <EmployeePicker employees={employees} onPick={setPicked} />}
        {emp && logs === null && <div className="flex justify-center mt-20"><Loader2 className="w-8 h-8 text-white animate-spin" /></div>}
        {emp && logs?.length === 0 && <p className="text-white/60 text-center mt-20" data-testid="kiosk-prints-none">{emp.name} heeft vandaag nog geen bonnen geprint.</p>}
        {emp && logs?.map((l) => <ReceiptRow key={l.id} log={l} onPrint={onPrint} busy={busyId === l.id} />)}
      </div>
    </div>
  ), document.body);
}
