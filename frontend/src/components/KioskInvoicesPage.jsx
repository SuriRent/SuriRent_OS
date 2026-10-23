import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Search, Loader2, CalendarPlus, FilePlus2, Building2, X, MessageCircle,
  CheckCircle, AlertCircle, Wallet, Users, CalendarDays,
} from 'lucide-react';
import { api, formatError, MONTHS_NL } from '../lib/api';
import { fmtAmount, groupByTenant } from '../pages/vastgoed/admin/invoices/helpers';
import InvoiceForm from '../pages/vastgoed/admin/invoices/InvoiceForm';
import ReminderModal from '../pages/vastgoed/admin/invoices/ReminderModal';

const TABS = [
  { v: 'all', label: 'Alle', key: 'allCount' },
  { v: 'open', label: 'Achterstand', key: 'openCount' },
  { v: 'paid', label: 'Betaald', key: 'paidCount' },
];
const CARD = 'bg-white rounded-2xl shadow-[0_10px_30px_-10px_rgba(120,40,0,0.45)] flex flex-col min-h-0 overflow-hidden';

function StatusBadge({ g }) {
  if (g.dueCount === 0) return <span className="rounded-full bg-emerald-600 text-white text-xs font-bold px-3 py-1">Betaald</span>;
  const cls = g.severity === 'critical' ? 'bg-red-500' : g.severity === 'late' ? 'bg-amber-500' : 'bg-orange-500';
  const txt = g.overdueCount > 0 ? `Achterstand · ${g.overdueCount}` : 'Deze maand';
  return <span className={`rounded-full text-white text-xs font-bold px-3 py-1 ${cls}`}>{txt}</span>;
}

function TenantLine({ g, active, onPick }) {
  return (
    <button type="button" onClick={() => onPick(g)} data-testid={`kiosk-inv-tenant-${g.tenant_id}`}
      className={`w-full flex items-center gap-4 px-5 py-4 text-left border-b border-slate-100 transition-colors ${active ? 'bg-orange-50' : 'hover:bg-slate-50'}`}>
      <span className="w-12 h-12 rounded-full bg-orange-50 text-[#FF5C00] flex items-center justify-center shrink-0"><Building2 className="w-6 h-6" /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-lg font-black text-slate-900 truncate">{g.tenant_name}</span>
        <span className="block text-sm text-slate-500 truncate">Appt. {g.apartment_number || '—'}{g.dueCount ? ` · ${g.dueCount} open maand${g.dueCount === 1 ? '' : 'en'}` : ''}</span>
      </span>
      <span className="flex flex-col items-end gap-1 shrink-0">
        <span className={`text-lg font-black ${g.totalDue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtAmount(g.totalDue, g.currency)}</span>
        <StatusBadge g={g} />
      </span>
    </button>
  );
}

function Kpi({ Icon, label, value, testId }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-slate-50 px-4 py-3">
      <span className="w-11 h-11 rounded-xl bg-orange-100 text-[#FF5C00] flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
      <span className="min-w-0">
        <span className="block text-xs font-bold uppercase tracking-widest text-slate-400">{label}</span>
        <span className="block text-2xl font-black text-slate-900 truncate" data-testid={testId}>{value}</span>
      </span>
    </div>
  );
}

function SummaryPanel({ summary, busy, msg, onGenerate, onNew }) {
  const today = new Date();
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 flex flex-col gap-3" data-testid="kiosk-inv-summary">
      <h2 className="text-2xl font-black text-slate-900 mb-1">Overzicht</h2>
      <Kpi Icon={Wallet} label="Totaal openstaand" value={fmtAmount(summary?.totalOpenAmount || 0, summary?.currency || 'SRD')} testId="kiosk-inv-total-open" />
      <Kpi Icon={Users} label="Achterstallige huurders" value={summary?.openCount || 0} testId="kiosk-inv-open-count" />
      <Kpi Icon={CalendarDays} label="Deze maand verwacht" value={fmtAmount(summary?.thisMonthExpected || 0, summary?.currency || 'SRD')} testId="kiosk-inv-month-expected" />
      <div className="mt-auto pt-3 flex flex-col gap-3">
        <button type="button" onClick={onGenerate} disabled={busy} data-testid="kiosk-inv-generate"
          className="h-16 rounded-2xl bg-white border-2 border-[#FF5C00] text-[#FF5C00] text-lg font-black inline-flex items-center justify-center gap-2 hover:bg-orange-50 disabled:opacity-60 transition-colors">
          {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <CalendarPlus className="w-6 h-6" />}
          Genereer {MONTHS_NL[today.getMonth()]}
        </button>
        <button type="button" onClick={onNew} data-testid="kiosk-inv-new"
          className="h-16 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] text-white text-lg font-black inline-flex items-center justify-center gap-2 shadow-[0_12px_28px_-10px_rgba(255,92,0,0.7)] transition-colors">
          <FilePlus2 className="w-6 h-6" /> Nieuwe factuur
        </button>
        {msg && (
          <p data-testid="kiosk-inv-msg" className={`flex items-center gap-2 text-sm font-bold rounded-xl px-4 py-3 ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {msg.ok ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

function DetailPanel({ g, onClose, onReminder }) {
  const rows = [...g.all].reverse();
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="kiosk-inv-detail">
      <div className="flex items-start gap-3 p-5 sm:p-6 border-b border-slate-100">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-black text-slate-900 truncate" data-testid="kiosk-inv-detail-name">{g.tenant_name}</h2>
          <p className="text-slate-500">Appt. {g.apartment_number || '—'}{g.location_name ? ` · ${g.location_name}` : ''}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Sluiten" data-testid="kiosk-inv-detail-close"
          className="w-11 h-11 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-5 sm:px-6 py-4 bg-orange-50 flex items-center justify-between">
        <span className="font-bold text-slate-600">Totaal openstaand</span>
        <span className={`text-2xl font-black ${g.totalDue > 0 ? 'text-red-600' : 'text-emerald-600'}`} data-testid="kiosk-inv-detail-total">{fmtAmount(g.totalDue, g.currency)}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {rows.map((inv) => {
          const open = Number(inv.remaining_amount != null ? inv.remaining_amount : inv.amount || 0);
          const paid = !g.open.includes(inv);
          return (
            <div key={inv.id} className="flex items-center gap-3 px-5 sm:px-6 py-3 border-b border-slate-100" data-testid={`kiosk-inv-row-${inv.id}`}>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-900">{MONTHS_NL[inv.period_month - 1]} {inv.period_year}</p>
                <p className="text-xs text-slate-500">{inv.invoice_number} · {fmtAmount(inv.amount, inv.currency)}</p>
              </div>
              {paid
                ? <span className="rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-1">Betaald</span>
                : <span className="text-base font-black text-red-600">{fmtAmount(open, inv.currency)}</span>}
            </div>
          );
        })}
      </div>
      {g.dueCount > 0 && (
        <div className="p-4 border-t border-slate-100">
          <button type="button" onClick={() => onReminder(g)} data-testid="kiosk-inv-reminder"
            className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-black inline-flex items-center justify-center gap-2 transition-colors">
            <MessageCircle className="w-5 h-5" /> Herinnering sturen
          </button>
        </div>
      )}
    </div>
  );
}

// Kiosk-Facturen in de stijl van het Financieel overzicht: links huurders, rechts totalen/knoppen of details.
export default function KioskInvoicesPage({ onBack }) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [creating, setCreating] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [reminding, setReminding] = useState(null);

  const load = useCallback(() => {
    api.get('/invoices/grouped', { params: { tab, severity: 'all', q: q.trim(), offset: 0, limit: 500 } })
      .then(({ data: d }) => setData(d)).catch(() => setData({ invoices: [], tenant_ids: [] }));
  }, [tab, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { api.get('/tenants').then(({ data: d }) => setTenants(d || [])).catch(() => {}); }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const byId = new Map(groupByTenant(data.invoices || [], MONTHS_NL).map((g) => [g.tenant_id, g]));
    return (data.tenant_ids || []).map((id) => byId.get(id)).filter(Boolean);
  }, [data]);
  const summary = data?.summary;
  const sel = selected && (groups.find((g) => g.tenant_id === selected.tenant_id) || selected);

  const generate = async () => {
    const t = new Date();
    if (!window.confirm(`Maandfacturen voor ${MONTHS_NL[t.getMonth()]} ${t.getFullYear()} aanmaken voor alle bezette appartementen?`)) return;
    setBusy(true); setMsg(null);
    try {
      const { data: d } = await api.post('/invoices/generate-month', { period_month: t.getMonth() + 1, period_year: t.getFullYear() });
      setMsg({ ok: true, text: `${d.created} aangemaakt, ${d.skipped} overgeslagen` });
      load();
    } catch (e) { setMsg({ ok: false, text: formatError(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 1.5vh' }} data-testid="kiosk-admin-page-facturen">
      <div className="kiosk-chrome flex items-center gap-3 px-1 sm:px-2 py-2 shrink-0">
        <button onClick={onBack} data-testid="kiosk-admin-page-back"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-sm">Terug</span>
        </button>
        <span className="text-xl sm:text-2xl font-black text-white tracking-tight">Facturen</span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 sm:gap-4">
        <div className={`${CARD} md:flex-[3]`} data-testid="kiosk-inv-list">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col gap-3">
            <div className="flex gap-2">
              {TABS.map((t) => (
                <button key={t.v} type="button" onClick={() => setTab(t.v)} data-testid={`kiosk-inv-tab-${t.v}`}
                  className={`h-12 px-5 rounded-full text-base font-black inline-flex items-center gap-2 transition-colors ${tab === t.v ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-600 hover:bg-orange-50'}`}>
                  {t.label}
                  <span className={`min-w-[26px] h-[26px] px-1.5 rounded-full text-xs flex items-center justify-center ${tab === t.v ? 'bg-white/25' : 'bg-white'}`}>{summary?.[t.key] ?? 0}</span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-3 h-14 rounded-2xl bg-slate-50 ring-1 ring-slate-200 px-4">
              <Search className="w-5 h-5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek huurder of appartement…" data-testid="kiosk-inv-search"
                className="flex-1 min-w-0 bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:text-slate-400" />
            </label>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!data && <Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin mx-auto my-16" />}
            {data && groups.map((g) => <TenantLine key={g.tenant_id} g={g} active={sel?.tenant_id === g.tenant_id} onPick={setSelected} />)}
            {data && groups.length === 0 && <p className="text-center text-slate-500 font-semibold py-16" data-testid="kiosk-inv-empty">Geen facturen gevonden</p>}
          </div>
        </div>
        <div className={`${CARD} md:flex-[2]`}>
          {sel
            ? <DetailPanel g={sel} onClose={() => setSelected(null)} onReminder={setReminding} />
            : <SummaryPanel summary={summary} busy={busy} msg={msg} onGenerate={generate} onNew={() => setCreating(true)} />}
        </div>
      </div>
      {creating && <InvoiceForm tenants={tenants} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {reminding && <ReminderModal group={reminding} onClose={() => setReminding(null)} onSent={() => setReminding(null)} />}
    </div>
  );
}
