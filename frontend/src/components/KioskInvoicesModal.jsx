import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Search, Loader2, CalendarPlus, FilePlus2, Banknote, MessageCircle, Share2, Trash2,
  CheckCircle2, ChevronRight, FileSignature, X, Mail, History, RefreshCw,
} from 'lucide-react';
import { api, formatError, MONTHS_NL } from '../lib/api';
import { fmtAmount, groupByTenant } from '../pages/vastgoed/admin/invoices/helpers';
import InvoiceForm from '../pages/vastgoed/admin/invoices/InvoiceForm';
import ReminderModal from '../pages/vastgoed/admin/invoices/ReminderModal';
import QuickPayModal from '../pages/vastgoed/admin/invoices/QuickPayModal';
import PaidHistorySection from '../pages/vastgoed/admin/invoices/PaidHistorySection';

const TABS = [
  { v: 'all', label: 'Alle', key: 'allCount' },
  { v: 'open', label: 'Achterstand', key: 'openCount' },
  { v: 'paid', label: 'Betaald', key: 'paidCount' },
];
const money = (v, c) => `${c || 'SRD'} ${fmtAmount(v, c)}`;
const ICON_BTN = 'w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center transition-colors';

function statusOf(g) {
  if (g.overdueCount >= 2) return { txt: `${g.overdueCount} mnd achter`, cls: 'text-red-600' };
  if (g.overdueCount === 1) return { txt: '1 mnd achter', cls: 'text-amber-600' };
  if (g.currentCount > 0) return { txt: 'Deze maand open', cls: 'text-orange-600' };
  return { txt: 'Betaald', cls: 'text-emerald-600' };
}

async function shareInvoice(inv) {
  const url = `${process.env.REACT_APP_BACKEND_URL}/api/invoices/${inv.id}/image`;
  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], `factuur-${inv.invoice_number}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `Factuur ${inv.invoice_number}` }); return; }
  } catch { /* openen als terugval */ }
  window.open(url, '_blank');
}

function TenantRow({ g, onOpen }) {
  const st = statusOf(g);
  return (
    <button type="button" onClick={() => onOpen(g)} data-testid={`invoice-tenant-row-${g.tenant_id}`}
      className="w-full text-left rounded-xl border border-slate-200 hover:border-orange-300 px-4 py-3 flex items-center justify-between gap-3 transition-colors">
      <div className="min-w-0">
        <div className="text-sm font-black text-slate-900 truncate">{g.tenant_name}</div>
        <div className="text-xs text-slate-500 truncate">Appt. {g.apartment_number || '—'}{g.location_name ? ` · ${g.location_name}` : ''}</div>
        <div className="text-[11px] text-slate-400 mt-0.5">{g.dueCount > 0 ? `${g.dueCount} × ${fmtAmount(g.totalDue / g.dueCount, g.currency)}` : 'Geen openstaande maanden'}</div>
      </div>
      <div className="text-right shrink-0 flex items-center gap-2">
        <div>
          <div className="text-sm font-black text-slate-900">{money(g.totalDue, g.currency)}</div>
          <div className={`text-[11px] font-bold uppercase tracking-wide ${st.cls}`}>{st.txt}</div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300" />
      </div>
    </button>
  );
}

function InvoiceRow({ inv, open, onPayInvoice, onRemind, onDelete }) {
  const rest = Number(inv.remaining_amount != null ? inv.remaining_amount : inv.amount || 0);
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3" data-testid={`invoice-row-${inv.id}`}>
      <button type="button" onClick={() => open && onPayInvoice(inv)} className="min-w-0 flex-1 text-left" data-testid={`invoice-open-${inv.id}`}>
        <div className="text-sm font-black text-slate-900 capitalize">{MONTHS_NL[inv.period_month - 1]} {inv.period_year}</div>
        <div className="text-xs text-slate-500 truncate">{inv.invoice_number} · {money(inv.amount, inv.currency)}</div>
      </button>
      <div className="text-right shrink-0">
        <div className="text-sm font-black text-slate-900">{open ? money(rest, inv.currency) : money(inv.amount, inv.currency)}</div>
        <div className={`text-[11px] font-bold uppercase tracking-wide ${open ? 'text-red-600' : 'text-emerald-600'}`}>{open ? 'Open' : 'Betaald'}</div>
      </div>
      <button type="button" onClick={() => shareInvoice(inv)} aria-label="Delen" data-testid={`invoice-share-${inv.id}`}
        className={`${ICON_BTN} text-slate-500 hover:bg-orange-50 hover:text-[#FF5C00]`}><Share2 className="w-4 h-4" /></button>
      {open && (
        <>
          <button type="button" onClick={() => onRemind('email')} aria-label="E-mail" data-testid={`invoice-email-${inv.id}`}
            className={`${ICON_BTN} text-sky-600 hover:bg-sky-50`}><Mail className="w-4 h-4" /></button>
          <button type="button" onClick={() => onRemind('whatsapp')} aria-label="WhatsApp" data-testid={`invoice-wa-${inv.id}`}
            className={`${ICON_BTN} text-emerald-600 hover:bg-emerald-50`}><MessageCircle className="w-4 h-4" /></button>
          <button type="button" onClick={() => onDelete(inv)} aria-label="Verwijderen" data-testid={`invoice-delete-${inv.id}`}
            className={`${ICON_BTN} text-slate-400 hover:bg-red-50 hover:text-red-600`}><Trash2 className="w-4 h-4" /></button>
        </>
      )}
    </div>
  );
}

function TenantDetail({ g, onBack, onPay, onPayInvoice, onRemind, onDelete, onRebalanced }) {
  const [history, setHistory] = useState(false);
  const [rebalancing, setRebalancing] = useState(false);
  const [rebalanceMsg, setRebalanceMsg] = useState('');
  const rebalance = async () => {
    if (rebalancing) return;
    setRebalancing(true); setRebalanceMsg('');
    try {
      const { data } = await api.post(`/tenants/${g.tenant_id}/rebalance-credits`);
      const applied = Number(data.applied || 0);
      const before = Number(data.credit_before || 0);
      const after = Number(data.credit_after || 0);
      if (applied > 0) {
        const n = (data.invoices_updated || []).length;
        setRebalanceMsg(`${money(applied, g.currency)} verrekend over ${n} factu${n === 1 ? 'ur' : 'ren'}`);
        onRebalanced();
      } else if (before === 0 && after === 0) setRebalanceMsg('Geen openstaand tegoed gevonden — alles klopt al.');
      else setRebalanceMsg(`${money(after, g.currency)} tegoed staat nog open (geen passende factuur).`);
    } catch (e) { setRebalanceMsg(formatError(e) || 'Herverdeling mislukt'); }
    finally { setRebalancing(false); }
  };
  const paid = (g.all || []).filter((i) => (i.status || '') === 'paid');
  if (history) {
    return (
      <>
        <button type="button" onClick={() => setHistory(false)} data-testid="invoices-modal-history-back"
          className="inline-flex items-center gap-1.5 text-sm font-black text-[#FF5C00]"><ArrowLeft className="w-4 h-4" /> {g.tenant_name}</button>
        <div className="text-sm font-black text-slate-900 uppercase tracking-widest">Betalingsgeschiedenis · {paid.length}</div>
        {paid.length === 0
          ? <div className="text-center text-slate-500 py-10 text-sm">Nog geen betalingen voor deze huurder.</div>
          : <PaidHistorySection paidInvoices={paid} currency={g.currency} testidPrefix={`kiosk-history-${g.tenant_id}`} />}
      </>
    );
  }
  return (
    <>
      <button type="button" onClick={onBack} data-testid="invoices-modal-back"
        className="inline-flex items-center gap-1.5 text-sm font-black text-[#FF5C00]"><ArrowLeft className="w-4 h-4" /> Alle huurders</button>
      <div className="rounded-xl bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-base font-black text-slate-900 truncate" data-testid="invoices-modal-tenant">{g.tenant_name}</div>
            <button type="button" onClick={rebalance} disabled={rebalancing} data-testid="invoices-modal-rebalance"
              title="Herverdeel alle openstaande tegoeden over de openstaande facturen." aria-label="Herverdeel tegoeden"
              className="shrink-0 w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-[#FF5C00] hover:border-orange-300 inline-flex items-center justify-center transition-colors disabled:opacity-60">
              {rebalancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
          </div>
          <div className="text-xs text-slate-500 truncate">Appt. {g.apartment_number} · {g.location_name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Openstaand</div>
          <div className={`text-lg font-black ${statusOf(g).cls}`}>{money(g.totalDue, g.currency)}</div>
        </div>
      </div>
      {rebalanceMsg && (
        <p className="text-xs font-bold text-slate-700 text-center" data-testid="invoices-modal-rebalance-msg">{rebalanceMsg}</p>
      )}
      <div className={`grid ${g.dueCount > 0 ? 'grid-cols-3' : 'grid-cols-1'} gap-2`}>
        {g.dueCount > 0 && (
          <>
            <button type="button" onClick={() => onPay(g.tenant_id)} data-testid="invoices-modal-pay"
              className="h-11 rounded-xl bg-[#FF5C00] text-white font-black text-sm inline-flex items-center justify-center gap-2"><Banknote className="w-4 h-4" /> Betalen</button>
            <button type="button" onClick={() => onRemind(g, 'whatsapp')} data-testid="invoices-modal-remind"
              className="h-11 rounded-xl bg-emerald-600 text-white font-black text-sm inline-flex items-center justify-center gap-2"><MessageCircle className="w-4 h-4" /> Herinnering</button>
          </>
        )}
        <button type="button" onClick={() => setHistory(true)} data-testid="invoices-modal-history"
          className={`h-11 rounded-xl bg-slate-900 text-white font-black ${g.dueCount > 0 ? 'text-xs px-2 gap-1.5' : 'text-sm gap-2'} leading-tight inline-flex items-center justify-center min-w-0`}><History className="w-4 h-4 shrink-0" /> <span className="text-center">Betalings&shy;geschiedenis</span></button>
      </div>
      {[...g.all].reverse().map((inv) => (
        <InvoiceRow key={inv.id} inv={inv} open={g.open.includes(inv)} onDelete={onDelete}
          onPayInvoice={(i) => onPayInvoice(i, g)} onRemind={(ch) => onRemind(g, ch)} />
      ))}
    </>
  );
}

// Facturen als popup in de stijl van "Betalingen inzien" — alle factuurfuncties op één plek.
export function KioskInvoicesModal({ Shell, onClose, onPay }) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [selId, setSelId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [creating, setCreating] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [reminding, setReminding] = useState(null);
  const [quickPay, setQuickPay] = useState(null);

  const load = useCallback(() => {
    api.get('/invoices/grouped', { params: { tab, severity: 'all', q: q.trim(), offset: 0, limit: 500 } })
      .then(({ data: d }) => setData(d)).catch((e) => { setMsg({ ok: false, text: formatError(e) }); setData({ invoices: [], tenant_ids: [] }); });
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
    try { await api.delete(`/invoices/${inv.id}`); setMsg({ ok: true, text: `Factuur ${inv.invoice_number} verwijderd` }); load(); }
    catch (e) { setMsg({ ok: false, text: formatError(e) }); }
  };

  const footer = (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={generate} disabled={busy} data-testid="invoices-modal-generate"
        className="h-12 rounded-xl bg-orange-50 text-[#FF5C00] font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />} Genereer {month}
      </button>
      <button type="button" onClick={() => setCreating(true)} data-testid="invoices-modal-new"
        className="h-12 rounded-xl bg-[#FF5C00] text-white font-black text-sm inline-flex items-center justify-center gap-2">
        <FilePlus2 className="w-4 h-4" /> Nieuwe factuur
      </button>
      <button type="button" onClick={onClose} data-testid="invoices-modal-close"
        className="col-span-2 h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">Sluiten</button>
    </div>
  );

  return (
    <>
      <Shell title="Facturen" Icon={FileSignature} testId="invoices-modal" onClose={onClose} footer={footer}>
        {() => (
          <>
            {msg && (
              <div data-testid="invoices-modal-msg" className={`rounded-xl text-sm font-semibold px-4 py-3 flex items-center justify-between gap-2 ${msg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                <span className="inline-flex items-center gap-2">{msg.ok && <CheckCircle2 className="w-4 h-4" />}{msg.text}</span>
                <button type="button" onClick={() => setMsg(null)} aria-label="Sluiten"><X className="w-4 h-4" /></button>
              </div>
            )}
            {sel ? (
              <TenantDetail key={sel.tenant_id} g={sel} onBack={() => setSelId(null)} onPay={onPay} onDelete={del}
                onRebalanced={load} onRemind={(g, ch) => setReminding({ g, ch })} onPayInvoice={(inv, g) => setQuickPay({ inv, g })} />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {[['Openstaand', money(s.totalOpenAmount || 0, s.currency), 'text-red-600'],
                    ['Achterstand', `${s.openCount || 0} van ${s.allCount || 0}`, 'text-amber-600'],
                    [`Verwacht ${month}`, money(s.thisMonthExpected || 0, s.currency), 'text-emerald-600']].map(([l, v, c]) => (
                    <div key={l} className="rounded-xl bg-slate-50 px-3 py-2 min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 truncate">{l}</div>
                      <div className={`text-sm font-black truncate ${c}`}>{v}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {TABS.map((t) => (
                    <button key={t.v} type="button" onClick={() => setTab(t.v)} data-testid={`invoices-modal-tab-${t.v}`}
                      className={`flex-1 h-10 rounded-xl text-xs font-black transition-colors ${tab === t.v ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-600'}`}>
                      {t.label} ({s[t.key] ?? 0})
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 h-11 rounded-xl border border-slate-200 px-3">
                  <Search className="w-4 h-4 text-slate-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek huurder of appartement…" data-testid="invoices-modal-search"
                    className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
                </label>
                {!data && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-[#FF5C00] animate-spin" /></div>}
                {data && groups.length === 0 && <div className="text-center text-slate-500 py-10 text-sm">Geen facturen gevonden.</div>}
                {groups.map((g) => <TenantRow key={g.tenant_id} g={g} onOpen={(x) => setSelId(x.tenant_id)} />)}
              </>
            )}
          </>
        )}
      </Shell>
      {creating && <InvoiceForm tenants={tenants} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {reminding && <ReminderModal group={reminding.g} initialChannel={reminding.ch} onClose={() => setReminding(null)}
        onSent={() => { setReminding(null); setMsg({ ok: true, text: 'Herinnering verzonden' }); }} />}
      {quickPay && <QuickPayModal invoice={quickPay.inv} tenantName={quickPay.g.tenant_name} tenantPhone={quickPay.g.tenant_phone || ''}
        otherOpenInvoices={quickPay.g.open.filter((i) => i.id !== quickPay.inv.id)}
        onClose={() => setQuickPay(null)} onSuccess={() => { setQuickPay(null); load(); }} />}
    </>
  );
}
