import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, CheckCircle2, Clock, Loader2, Printer, Receipt, UserRound, X } from 'lucide-react';
import { api, fmtMoney } from '../lib/api';
import { printReceipt } from '../lib/kiosk-print';
import { KioskBulkApproveSheet } from './KioskBulkApproveSheet';

const todayStartIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '');
const POLL_MS = 15000;
// Lazy: handtekening-sheet uit Betalingen pas laden als de beheerder goedkeurt.
const ApprovePaymentSheet = lazy(() => import('../pages/vastgoed/admin/Payments').then((m) => ({ default: m.ApprovePaymentSheet })));

function OnlineDot({ online }) {
  return <span className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} />;
}

function EmployeePicker({ employees, activeKeys, onPick }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="kiosk-prints-employee-picker">
      {employees.map((e) => (
        <button key={e.key} onClick={() => onPick(e)} data-testid={`kiosk-prints-employee-${e.key}`}
          className="bg-white rounded-2xl p-5 flex items-center gap-4 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-transform text-left">
          <span className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center"><UserRound className="w-6 h-6" /></span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-slate-900 text-lg truncate">{e.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500"><OnlineDot online={activeKeys.has(e.key)} />{activeKeys.has(e.key) ? 'Online' : 'Offline'}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ReceiptRow({ log, onPrint, onApprove, busy }) {
  const p = log.payment;
  const done = !!log.admin_printed_at;
  const pending = p.status === 'pending_approval';
  return (
    <div className={`rounded-2xl p-3 sm:px-4 sm:py-3 shadow flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 ${done ? 'bg-emerald-50' : 'bg-white'}`} data-testid={`kiosk-print-log-${log.id}`}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <Receipt className="w-5 h-5 text-[#FF5C00] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm sm:text-base break-words">{p.tenant_name || 'Huurder'}</p>
          <p className="text-xs text-slate-400 font-medium break-all">{p.receipt_number}</p>
          <p className="text-xs text-slate-500 mt-0.5">{log.employee_printed ? 'Geprint' : 'Betaald'} om {fmtTime(log.printed_at)}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            {pending && <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-bold"><Clock className="w-3 h-3" /> Wacht op goedkeuring</span>}
            {done && (
              <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold" data-testid={`kiosk-print-log-done-${log.id}`}>
                <Check className="w-3.5 h-3.5" /> Afgedrukt
              </span>
            )}
          </div>
        </div>
        <span className="font-black text-slate-900 whitespace-nowrap text-sm sm:text-base">{fmtMoney(p.amount, p.currency)}</span>
      </div>
      <div className="flex gap-2 sm:shrink-0">
        {pending && (
          <button onClick={() => onApprove(log)} data-testid={`kiosk-print-log-approve-${log.id}`}
            className="flex-1 sm:flex-none h-10 px-3 sm:px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-colors">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> Goedkeuren
          </button>
        )}
        <button onClick={() => onPrint(log)} disabled={busy} data-testid={`kiosk-print-log-print-${log.id}`}
          className={`flex-1 sm:flex-none h-10 px-3 sm:px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-60 transition-colors ${done ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50' : 'bg-[#FF5C00] hover:bg-[#E05200] text-white'}`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Printer className="w-4 h-4 shrink-0" />} {done ? 'Opnieuw' : 'Afdrukken'}
        </button>
      </div>
    </div>
  );
}

export function KioskPrintsOverlay({ employees: active, printsVersion, onClose }) {
  const [picked, setPicked] = useState(null);
  const [todayEmps, setTodayEmps] = useState([]);
  const [logs, setLogs] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [approving, setApproving] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const activeKeys = useMemo(() => new Set(active.map((e) => e.key)), [active]);
  // Actieve medewerkers + medewerkers met bonnen vandaag (ook offline).
  const employees = useMemo(() => {
    const m = new Map(todayEmps.map((e) => [e.key, e]));
    active.forEach((e) => m.set(e.key, e));
    return [...m.values()].sort((a, b) => (activeKeys.has(b.key) - activeKeys.has(a.key)) || a.name.localeCompare(b.name));
  }, [todayEmps, active, activeKeys]);
  const emp = picked || (employees.length === 1 ? employees[0] : null);

  const loadEmps = useCallback(() => {
    api.get('/kiosk/print-log/employees', { params: { since: todayStartIso() } }).then(({ data }) => setTodayEmps(data)).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    if (!emp) return;
    try {
      const { data } = await api.get('/kiosk/print-log', { params: { since: todayStartIso(), employee: emp.key } });
      setLogs(data);
    } catch { setLogs((l) => l || []); }
  }, [emp?.key]); // eslint-disable-line
  useEffect(() => { setLogs(null); load(); }, [emp?.key]); // eslint-disable-line
  useEffect(() => { loadEmps(); if (printsVersion) load(); }, [printsVersion]); // eslint-disable-line
  // Nieuwe kiosk-betalingen (zonder print-event) ook oppikken.
  useEffect(() => {
    const id = setInterval(() => { loadEmps(); load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load, loadEmps]);

  const pendingLogs = (logs || []).filter((l) => l.payment.status === 'pending_approval');

  const onPrint = async (log) => {
    setBusyId(log.id);
    try {
      await printReceipt({ paymentId: log.payment_id, apiGet: api.get, relay: false });
      await api.post(`/kiosk/print-log/by-payment/${log.payment_id}/printed`);
      setLogs((ls) => ls.map((l) => (l.id === log.id ? { ...l, admin_printed_at: new Date().toISOString() } : l)));
    } catch { /* print-dialoog geannuleerd of netwerkfout */ }
    finally { setBusyId(null); }
  };

  return createPortal((
    <div className="fixed inset-0 z-[10000] bg-slate-900/95 backdrop-blur-md flex flex-col" data-testid="kiosk-prints-overlay"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 sm:py-4 text-white">
        {picked && employees.length > 1 && (
          <button onClick={() => setPicked(null)} data-testid="kiosk-prints-back" className="h-10 px-3 rounded-xl bg-white/10 hover:bg-white/20 flex items-center gap-1.5 text-sm font-bold">
            <ArrowLeft className="w-4 h-4" /> Medewerkers
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] sm:text-xs uppercase tracking-widest text-emerald-400 font-bold">Bonnen van vandaag</p>
          <p className="text-lg sm:text-xl font-black flex items-center gap-2 min-w-0 truncate" data-testid="kiosk-prints-title">
            {emp ? <><OnlineDot online={activeKeys.has(emp.key)} />{emp.name}<span className="text-xs font-bold text-white/50">{activeKeys.has(emp.key) ? 'online' : 'offline'}</span></> : 'Kies een medewerker'}
          </p>
        </div>
        {emp && pendingLogs.length > 1 && (
          <button onClick={() => setBulkOpen(true)} data-testid="kiosk-prints-approve-all"
            className="order-last sm:order-none w-full sm:w-auto h-11 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors">
            <CheckCircle2 className="w-4 h-4" /> Alles goedkeuren ({pendingLogs.length})
          </button>
        )}
        <button onClick={onClose} data-testid="kiosk-prints-close" className="w-11 h-11 shrink-0 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 pb-6 space-y-3">
        {!emp && employees.length === 0 && <p className="text-white/60 text-center mt-20" data-testid="kiosk-prints-empty">Vandaag nog geen bonnen van kiosk-medewerkers.</p>}
        {!emp && employees.length > 1 && <EmployeePicker employees={employees} activeKeys={activeKeys} onPick={setPicked} />}
        {emp && logs === null && <div className="flex justify-center mt-20"><Loader2 className="w-8 h-8 text-white animate-spin" /></div>}
        {emp && logs?.length === 0 && <p className="text-white/60 text-center mt-20" data-testid="kiosk-prints-none">{emp.name} heeft vandaag nog geen bonnen.</p>}
        {emp && logs?.map((l) => <ReceiptRow key={l.id} log={l} onPrint={onPrint} onApprove={setApproving} busy={busyId === l.id} />)}
      </div>
      {bulkOpen && (
        <KioskBulkApproveSheet logs={pendingLogs} employeeName={emp?.name || ''}
          onClose={() => setBulkOpen(false)}
          onDone={(allOk) => { load(); if (allOk) setBulkOpen(false); }} />
      )}
      {approving && (
        <Suspense fallback={null}>
          <ApprovePaymentSheet
            payment={{ ...approving.payment, kiosk_employee_name: approving.employee_name }}
            modalClassName="!z-[10050]"
            onCancel={() => setApproving(null)}
            onApproved={() => { setApproving(null); load(); }} />
        </Suspense>
      )}
    </div>
  ), document.body);
}
