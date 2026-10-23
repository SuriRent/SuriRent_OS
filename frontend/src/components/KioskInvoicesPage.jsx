import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Search, Loader2, CalendarPlus, FilePlus2, Wallet, AlertTriangle, CalendarDays,
  Banknote, MessageCircle, Share2, Trash2, CheckCircle2, ChevronRight, X,
} from 'lucide-react';
import { api, formatError, MONTHS_NL } from '../lib/api';
import { fmtAmount, groupByTenant } from '../pages/vastgoed/admin/invoices/helpers';
import InvoiceForm from '../pages/vastgoed/admin/invoices/InvoiceForm';
import ReminderModal from '../pages/vastgoed/admin/invoices/ReminderModal';

const CARD = 'bg-white rounded-3xl shadow-[0_10px_30px_-10px_rgba(120,40,0,0.45)] flex flex-col min-h-0 overflow-hidden';
const TABS = [
  { v: 'all', label: 'Alle', key: 'allCount' },
  { v: 'open', label: 'Achterstand', key: 'openCount', dot: 'bg-red-500' },
  { v: 'paid', label: 'Betaald', key: 'paidCount', dot: 'bg-emerald-500' },
];

// Kleur + tekst per huurder-status.
function toneOf(g) {
  if (g.overdueCount >= 2) return { bar: 'bg-red-500', chip: 'bg-red-50 text-red-700', amt: 'text-red-600', text: `${g.overdueCount} maanden achter` };
  if (g.overdueCount === 1) return { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700', amt: 'text-amber-600', text: '1 maand achter' };
  if (g.currentCount > 0) return { bar: 'bg-orange-400', chip: 'bg-orange-50 text-orange-700', amt: 'text-orange-600', text: 'Deze maand open' };
  return { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700', amt: 'text-emerald-600', text: 'Alles betaald' };
}
const money = (v, c) => `${c || 'SRD'} ${fmtAmount(v, c)}`;
const openPay = (tenantId) => window.dispatchEvent(new CustomEvent('kiosk-open-tenant', { detail: { tenant_id: tenantId } }));

function Stat({ Icon, label, value, tone, testId }) {
  return (
    <div className="flex-1 min-w-0 rounded-2xl bg-slate-50 px-4 py-3 flex items-center gap-3">
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tone}`}><Icon className="w-5 h-5" /></span>
      <span className="min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 truncate">{label}</span>
        <span className="block text-xl xl:text-2xl font-black text-slate-900 truncate" data-testid={testId}>{value}</span>
      </span>
    </div>
  );
}

function TenantTile({ g, onOpen, onRemind }) {
  const t = toneOf(g);
  const per = g.dueCount > 0 ? `${g.dueCount} × ${fmtAmount(g.totalDue / g.dueCount, g.currency)}` : 'Geen openstaande maanden';
  return (
    <div className="relative bg-white rounded-2xl ring-1 ring-slate-100 shadow-[0_6px_18px_-10px_rgba(120,40,0,0.35)] overflow-hidden flex flex-col"
      data-testid={`kiosk-inv-tile-${g.tenant_id}`}>
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${t.bar}`} />
      <button type="button" onClick={() => onOpen(g)} className="text-left pl-5 pr-4 pt-4 pb-3 flex-1 flex flex-col justify-start hover:bg-orange-50/40 transition-colors"
        data-testid={`kiosk-inv-open-${g.tenant_id}`}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-black text-slate-900 uppercase tracking-tight truncate">{g.apartment_number || '—'}</p>
            <p className="text-sm font-bold text-slate-700 truncate">{g.tenant_name}</p>
            <p className="text-xs text-slate-400 truncate">{g.location_name}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300 shrink-0 mt-1" />
        </div>
        <div className="mt-3 flex items-end justify-between gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${t.chip}`}>{t.text}</span>
          <span className="text-right">
            <span className={`block text-xl font-black ${t.amt}`}>{money(g.totalDue, g.currency)}</span>
            <span className="block text-[11px] text-slate-400">{per}</span>
          </span>
        </div>
      </button>
      {g.dueCount > 0 && (
        <div className="grid grid-cols-2 border-t border-slate-100">
          <button type="button" onClick={() => openPay(g.tenant_id)} data-testid={`kiosk-inv-pay-${g.tenant_id}`}
            className="h-12 inline-flex items-center justify-center gap-2 font-black text-[#FF5C00] hover:bg-orange-50 transition-colors">
            <Banknote className="w-5 h-5" /> Betalen
          </button>
          <button type="button" onClick={() => onRemind(g)} data-testid={`kiosk-inv-remind-${g.tenant_id}`}
            className="h-12 inline-flex items-center justify-center gap-2 font-black text-emerald-700 hover:bg-emerald-50 border-l border-slate-100 transition-colors">
            <MessageCircle className="w-5 h-5" /> Herinnering
          </button>
        </div>
      )}
    </div>
  );
}

async function shareInvoice(inv) {
  const url = `${process.env.REACT_APP_BACKEND_URL}/api/invoices/${inv.id}/image`;
  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], `factuur-${inv.invoice_number}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `Factuur ${inv.invoice_number}` }); return; }
  } catch { /* valt terug op openen */ }
  window.open(url, '_blank');
}

function InvoiceLine({ inv, open, onDelete }) {
  const rest = Number(inv.remaining_amount != null ? inv.remaining_amount : inv.amount || 0);
  const late = open && inv.bucket !== 'current' && inv.bucket !== 'future';
  return (
    <div className="flex items-center gap-4 py-3" data-testid={`kiosk-inv-line-${inv.id}`}>
      <span className={`w-3 h-3 rounded-full shrink-0 ring-4 ${!open ? 'bg-emerald-500 ring-emerald-100' : late ? 'bg-red-500 ring-red-100' : 'bg-orange-400 ring-orange-100'}`} />
      <div className="flex-1 min-w-0">
        <p className="font-black text-slate-900 capitalize">{MONTHS_NL[inv.period_month - 1]} {inv.period_year}</p>
        <p className="text-xs text-slate-400">{inv.invoice_number} · {money(inv.amount, inv.currency)}</p>
      </div>
      {open
        ? <span className={`text-lg font-black ${late ? 'text-red-600' : 'text-orange-600'}`}>{money(rest, inv.currency)}</span>
        : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-1"><CheckCircle2 className="w-4 h-4" /> Betaald</span>}
      <button type="button" onClick={() => shareInvoice(inv)} aria-label="Delen" data-testid={`kiosk-inv-share-${inv.id}`}
        className="w-11 h-11 rounded-xl bg-slate-50 hover:bg-orange-50 text-slate-500 hover:text-[#FF5C00] flex items-center justify-center transition-colors"><Share2 className="w-5 h-5" /></button>
      {open && (
        <button type="button" onClick={() => onDelete(inv)} aria-label="Verwijderen" data-testid={`kiosk-inv-delete-${inv.id}`}
          className="w-11 h-11 rounded-xl bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center transition-colors"><Trash2 className="w-5 h-5" /></button>
      )}
    </div>
  );
}

function TenantDetail({ g, onBack, onRemind, onDelete }) {
  const t = toneOf(g);
  const rows = [...g.all].reverse();
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="kiosk-inv-detail">
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <button type="button" onClick={onBack} data-testid="kiosk-inv-detail-back"
          className="h-11 px-4 rounded-xl bg-orange-50 hover:bg-orange-100 text-[#FF5C00] font-bold inline-flex items-center gap-2"><ArrowLeft className="w-5 h-5" /> Alle huurders</button>
      </div>
      <div className="mx-5 rounded-2xl bg-slate-50 p-5 flex items-center gap-4">
        <span className={`w-2 self-stretch rounded-full ${t.bar}`} />
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-black text-slate-900 truncate" data-testid="kiosk-inv-detail-name">{g.tenant_name}</p>
          <p className="text-sm text-slate-500 truncate">Appt. {g.apartment_number} · {g.location_name}</p>
          <span className={`inline-block mt-2 rounded-full px-3 py-1 text-xs font-bold ${t.chip}`}>{t.text}</span>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Openstaand</p>
          <p className={`text-3xl font-black ${t.amt}`} data-testid="kiosk-inv-detail-total">{money(g.totalDue, g.currency)}</p>
        </div>
      </div>
      {g.dueCount > 0 && (
        <div className="grid grid-cols-2 gap-3 px-5 pt-3">
          <button type="button" onClick={() => openPay(g.tenant_id)} data-testid="kiosk-inv-detail-pay"
            className="h-14 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] text-white text-lg font-black inline-flex items-center justify-center gap-2 transition-colors"><Banknote className="w-5 h-5" /> Betalen</button>
          <button type="button" onClick={() => onRemind(g)} data-testid="kiosk-inv-detail-remind"
            className="h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-black inline-flex items-center justify-center gap-2 transition-colors"><MessageCircle className="w-5 h-5" /> Herinnering</button>
        </div>
      )}
      <p className="px-5 pt-4 pb-1 text-xs font-black uppercase tracking-widest text-slate-400">Facturen ({rows.length})</p>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 divide-y divide-slate-100">
        {rows.map((inv) => <InvoiceLine key={inv.id} inv={inv} open={g.open.includes(inv)} onDelete={onDelete} />)}
      </div>
    </div>
  );
}

export default function KioskInvoicesPage({ onBack }) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [selId, setSelId] = useState(null);
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
  const sel = groups.find((g) => g.tenant_id === selId);
  const s = data?.summary || {};
  const month = MONTHS_NL[new Date().getMonth()];

  const generate = async () => {
    const t = new Date();
    if (!window.confirm(`Maandfacturen voor ${month} ${t.getFullYear()} aanmaken voor alle bezette appartementen?`)) return;
    setBusy(true); setMsg(null);
    try {
      const { data: d } = await api.post('/invoices/generate-month', { period_month: t.getMonth() + 1, period_year: t.getFullYear() });
      setMsg({ ok: true, text: `${d.created} aangemaakt, ${d.skipped} overgeslagen` });
      load();
    } catch (e) { setMsg({ ok: false, text: formatError(e) }); }
    finally { setBusy(false); }
  };
  const del = async (inv) => {
    if (!window.confirm(`Factuur ${inv.invoice_number} verwijderen?`)) return;
    try { await api.delete(`/invoices/${inv.id}`); load(); } catch (e) { setMsg({ ok: false, text: formatError(e) }); }
  };

  return (
    <div className="h-full bg-orange-500 flex flex-col md:flex-row gap-3 sm:gap-4" style={{ padding: '1.5vh 1.5vw 0' }} data-testid="kiosk-admin-page-facturen">
      <div className={`${CARD} flex-1`} data-testid="kiosk-inv-list">
        {sel ? <TenantDetail g={sel} onBack={() => setSelId(null)} onRemind={setReminding} onDelete={del} /> : (
          <>
            <div className="flex gap-3 px-5 pt-5">
              <Stat Icon={Wallet} label="Openstaand" value={money(s.totalOpenAmount || 0, s.currency)} tone="bg-red-50 text-red-600" testId="kiosk-inv-stat-open" />
              <Stat Icon={AlertTriangle} label="Met achterstand" value={`${s.openCount || 0} van ${s.allCount || 0}`} tone="bg-amber-50 text-amber-600" testId="kiosk-inv-stat-late" />
              <Stat Icon={CalendarDays} label={`Verwacht ${month}`} value={money(s.thisMonthExpected || 0, s.currency)} tone="bg-emerald-50 text-emerald-600" testId="kiosk-inv-stat-month" />
            </div>
            <div className="flex items-center gap-2 px-5 pt-4 pb-3">
              {TABS.map((t) => (
                <button key={t.v} type="button" onClick={() => setTab(t.v)} data-testid={`kiosk-inv-tab-${t.v}`}
                  className={`h-11 px-4 rounded-full text-sm font-black inline-flex items-center gap-2 transition-colors ${tab === t.v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {t.dot && <span className={`w-2 h-2 rounded-full ${t.dot}`} />}{t.label} <span className="opacity-60">{s[t.key] ?? 0}</span>
                </button>
              ))}
              <label className="ml-auto flex items-center gap-2 h-11 w-full max-w-xs rounded-full bg-slate-100 px-4">
                <Search className="w-4 h-4 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek huurder of appt…" data-testid="kiosk-inv-search"
                  className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
                {q && <button type="button" onClick={() => setQ('')} aria-label="Wissen"><X className="w-4 h-4 text-slate-400" /></button>}
              </label>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
              {!data && <Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin mx-auto my-16" />}
              <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
                {groups.map((g) => <TenantTile key={g.tenant_id} g={g} onOpen={(x) => setSelId(x.tenant_id)} onRemind={setReminding} />)}
              </div>
              {data && groups.length === 0 && <p className="text-center text-slate-500 font-semibold py-16" data-testid="kiosk-inv-empty">Geen facturen gevonden</p>}
            </div>
          </>
        )}
      </div>
      <div className={`${CARD} md:w-[320px] shrink-0 p-4 sm:p-5 gap-3 mb-3`} data-testid="kiosk-inv-actions">
        <button onClick={onBack} data-testid="kiosk-admin-page-back"
          className="h-12 rounded-xl bg-orange-50 hover:bg-orange-100 text-[#FF5C00] font-bold inline-flex items-center justify-center gap-2 transition-colors">
          <ArrowLeft className="w-5 h-5" /> Terug naar kiosk
        </button>
        <button type="button" onClick={generate} disabled={busy} data-testid="kiosk-inv-generate"
          className="h-16 rounded-2xl bg-white border-2 border-[#FF5C00] text-[#FF5C00] text-lg font-black inline-flex items-center justify-center gap-2 hover:bg-orange-50 disabled:opacity-60 transition-colors">
          {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <CalendarPlus className="w-6 h-6" />} Genereer {month}
        </button>
        <button type="button" onClick={() => setCreating(true)} data-testid="kiosk-inv-new"
          className="h-16 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] text-white text-lg font-black inline-flex items-center justify-center gap-2 shadow-[0_12px_28px_-10px_rgba(255,92,0,0.7)] transition-colors">
          <FilePlus2 className="w-6 h-6" /> Nieuwe factuur
        </button>
        {msg && <p data-testid="kiosk-inv-msg" className={`text-sm font-bold rounded-xl px-4 py-3 ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      </div>
      {creating && <InvoiceForm tenants={tenants} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {reminding && <ReminderModal group={reminding} onClose={() => setReminding(null)} onSent={() => setReminding(null)} />}
    </div>
  );
}
