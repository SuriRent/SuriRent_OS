import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Search, Loader2, CalendarPlus, FilePlus2, FileSignature, Wallet,
  Banknote, MessageCircle, Share2, Trash2, CheckCircle2, ChevronRight, X, History, RefreshCw,
} from 'lucide-react';
import { api, formatError, MONTHS_NL } from '../lib/api';
import { hostConfirm } from './EmbedConfirm';
import { openWhatsApp } from '../lib/external-link';
import { fmtAmount, groupByTenant } from '../pages/vastgoed/admin/invoices/helpers';
import InvoiceForm from '../pages/vastgoed/admin/invoices/InvoiceForm';
import QuickPayModal from '../pages/vastgoed/admin/invoices/QuickPayModal';
import PaidHistorySection from '../pages/vastgoed/admin/invoices/PaidHistorySection';
import ReminderModal from '../pages/vastgoed/admin/invoices/ReminderModal';
import { SeverityPills, useTenantCredits, creditOf, CreditBadge, InvoiceExtraActions } from './KioskInvoiceExtras';
import { TenantPhoto } from './KioskFx';

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
    <div className="min-w-0 rounded-2xl border border-slate-100 bg-slate-50 px-2.5 py-3 sm:px-4 flex items-center gap-2 sm:gap-3">
      <span className={`w-9 h-9 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 ${tone}`}><Icon className="w-4 h-4 sm:w-5 sm:h-5" /></span>
      <span className="min-w-0">
        <span className="block text-[9px] sm:text-[11px] font-bold uppercase tracking-wide sm:tracking-widest text-slate-400 truncate">{label}</span>
        <span className="block text-xs sm:text-lg xl:text-2xl font-black text-slate-900 truncate" data-testid={testId}>{value}</span>
      </span>
    </div>
  );
}

function TenantTile({ g, onOpen, onRemind, credit }) {
  const t = toneOf(g);
  const per = g.dueCount > 0 ? `${g.dueCount} × ${fmtAmount(g.totalDue / g.dueCount, g.currency)}` : 'Geen openstaande maanden';
  return (
    <div className="w-full rounded-2xl border border-slate-100 bg-white p-2 shadow-sm transition hover:bg-slate-50 sm:p-4"
      data-testid={`kiosk-inv-tile-${g.tenant_id}`}>
      <div className="flex items-center gap-1.5 sm:gap-3">
        <button type="button" onClick={() => onOpen(g)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left sm:gap-3"
          data-testid={`kiosk-inv-open-${g.tenant_id}`}>
          <span className="scale-90 sm:scale-100"><TenantPhoto tenantId={g.tenant_id} name={g.tenant_name} size={40} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <p className="truncate font-black text-slate-900">{g.apartment_number || 'Geen appartement'}</p>
              {g.tenant_name && <span className="max-w-[180px] truncate rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700 sm:px-2 sm:text-[10px]">{g.tenant_name}</span>}
            </div>
            <p className="truncate text-[10px] leading-tight text-slate-500 sm:mt-0.5 sm:text-xs">{g.location_name || ' '}</p>
            <CreditBadge amount={credit} currency={g.currency} testId={`kiosk-inv-credit-${g.tenant_id}`} />
          </div>
        </button>
        <div className="hidden shrink-0 text-right sm:block">
          <p className={`whitespace-nowrap text-base font-black ${t.amt}`}>{money(g.totalDue, g.currency)}</p>
          <p className="text-[10px] text-slate-400">{per}</p>
          <p className={`text-[10px] font-bold ${t.amt}`}>{t.text}</p>
        </div>
        {g.dueCount > 0 && (
          <div className="flex shrink-0 flex-row gap-1">
            <button type="button" onClick={() => openPay(g.tenant_id)} data-testid={`kiosk-inv-pay-${g.tenant_id}`}
              aria-label="Betalen" title="Betalen"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-orange-50 text-[#FF5C00] transition-colors hover:bg-orange-100 sm:h-8 sm:w-8 sm:rounded-lg">
              <Banknote className="h-3 w-3 sm:h-4 sm:w-4" />
            </button>
            <button type="button" onClick={() => onRemind(g)} data-testid={`kiosk-inv-remind-${g.tenant_id}`}
              aria-label="Herinnering" title="Herinnering"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 sm:h-8 sm:w-8 sm:rounded-lg">
              <MessageCircle className="h-3 w-3 sm:h-4 sm:w-4" />
            </button>
          </div>
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 sm:hidden">
        <span className={`text-[9px] font-bold ${t.amt}`}>{t.text}</span>
        <span className={`text-right text-xs font-black ${t.amt}`}>{money(g.totalDue, g.currency)}</span>
      </div>
    </div>
  );
}

async function shareInvoice(inv, tenant, onMsg) {
  onMsg?.(null);
  const apiBase = (api.defaults.baseURL || `${window.location.origin}/api`).replace(/\/+$/, '');
  const url = `${apiBase}/invoices/${inv.id}/image`;
  const phone = String(tenant?.phone || '').replace(/\D/g, '');
  const message = `Hierbij uw factuur ${inv.invoice_number || ''} voor ${MONTHS_NL[inv.period_month - 1]} ${inv.period_year}.`;
  const fallbackTab = window.open('about:blank', '_blank');
  const closeFallback = () => {
    if (fallbackTab && !fallbackTab.closed) fallbackTab.close();
  };
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Factuurbon ophalen mislukt (${response.status})`);
    const blob = await response.blob();
    const file = new File([blob], `factuur-${inv.invoice_number}.jpg`, { type: 'image/jpeg' });
    let canShareFile = false;
    try {
      canShareFile = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    } catch {
      canShareFile = false;
    }
    if (canShareFile) {
      try {
        await navigator.share({ files: [file], text: message, title: `Factuur ${inv.invoice_number}` });
        closeFallback();
        return;
      } catch (error) {
        if (error?.name === 'AbortError') {
          closeFallback();
          return;
        }
      }
    }
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    const fallbackMessage = `${message}\n\nDe bon is gedownload. Voeg de JPG-afbeelding als bijlage toe aan dit gesprek.`;
    if (phone.length >= 7) {
      if (fallbackTab && !fallbackTab.closed) {
        fallbackTab.location.replace(`https://wa.me/${phone}?text=${encodeURIComponent(fallbackMessage)}`);
      } else {
        openWhatsApp(phone, fallbackMessage);
      }
      onMsg?.({ ok: true, text: 'De bon is gedownload en WhatsApp met de huurder is geopend. Voeg de JPG daar als bijlage toe.' });
    } else {
      closeFallback();
      onMsg?.({ ok: true, text: 'De bon is gedownload. Deel de JPG vanuit uw downloads.' });
    }
  } catch (error) {
    closeFallback();
    onMsg?.({ ok: false, text: error?.message || 'De factuurbon kon niet worden gedeeld.' });
  }
}

function InvoiceLine({ inv, open, onPayInvoice, onDelete, credit, tenant, onChanged, onMsg }) {
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
      {open && (
        <button type="button" onClick={() => onPayInvoice(inv)} aria-label="Factuur betalen" title="Factuur betalen"
          data-testid={`kiosk-inv-pay-one-${inv.id}`}
          className="w-11 h-11 rounded-xl bg-orange-50 hover:bg-orange-100 text-[#FF5C00] flex items-center justify-center transition-colors">
          <Banknote className="w-5 h-5" />
        </button>
      )}
      <InvoiceExtraActions inv={inv} open={open} credit={credit} tenant={tenant} onChanged={onChanged} onMsg={onMsg} />
      <button type="button" onClick={() => shareInvoice(inv, tenant, onMsg)} aria-label="Delen" data-testid={`kiosk-inv-share-${inv.id}`}
        className="w-11 h-11 rounded-xl bg-slate-50 hover:bg-orange-50 text-slate-500 hover:text-[#FF5C00] flex items-center justify-center transition-colors"><Share2 className="w-5 h-5" /></button>
      {open && (
        <button type="button" onClick={() => onDelete(inv)} aria-label="Verwijderen" data-testid={`kiosk-inv-delete-${inv.id}`}
          className="w-11 h-11 rounded-xl bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center transition-colors"><Trash2 className="w-5 h-5" /></button>
      )}
    </div>
  );
}

function TenantDetail({ g, onBack, onRemind, onDelete, onPayInvoice, onNewInvoice, onRebalanced, credit, tenant, onChanged, onMsg }) {
  const [detailTab, setDetailTab] = useState('overzicht');
  const [rebalancing, setRebalancing] = useState(false);
  const [rebalanceMsg, setRebalanceMsg] = useState('');
  const t = toneOf(g);
  const rows = [...g.all].reverse();
  const paid = rows.filter((inv) => inv.status === 'paid');
  const rebalance = async () => {
    if (rebalancing) return;
    setRebalancing(true);
    setRebalanceMsg('');
    try {
      const { data: result } = await api.post(`/tenants/${g.tenant_id}/rebalance-credits`);
      const applied = Number(result.applied || 0);
      const before = Number(result.credit_before || 0);
      const after = Number(result.credit_after || 0);
      if (applied > 0) {
        const count = (result.invoices_updated || []).length;
        setRebalanceMsg(`${money(applied, g.currency)} verrekend over ${count} factu${count === 1 ? 'ur' : 'ren'}`);
        onRebalanced();
      } else if (before === 0 && after === 0) {
        setRebalanceMsg('Geen openstaand tegoed gevonden — alles klopt al.');
      } else {
        setRebalanceMsg(`${money(after, g.currency)} tegoed staat nog open (geen passende factuur).`);
      }
    } catch (error) {
      setRebalanceMsg(formatError(error) || 'Herverdeling mislukt');
    } finally {
      setRebalancing(false);
    }
  };
  return (
    <div className="flex min-h-full flex-col gap-3 pb-3" data-testid="kiosk-inv-detail">
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:p-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <TenantPhoto tenantId={g.tenant_id} name={g.tenant_name} size={56} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-widest text-[#FF5C00]">Huurder · Facturen</p>
            <h1 className="mt-0.5 truncate text-xl font-black tracking-tight text-slate-900 sm:text-2xl"
              data-testid="kiosk-inv-detail-apartment">{tenant?.name || g.tenant_name || 'Onbekende huurder'}</h1>
            <p className="truncate text-sm font-semibold text-slate-500" data-testid="kiosk-inv-detail-name">
              {g.apartment_number || 'Geen appartement'}{g.location_name ? ` · ${g.location_name}` : ''}
              {tenant?.rent_amount ? ` · ${money(tenant.rent_amount, tenant.currency || g.currency)} / maand` : ''}
            </p>
          </div>
          <span className={`hidden shrink-0 rounded-full px-3 py-1 text-xs font-black sm:inline-flex ${t.chip}`}>{t.text}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={onBack} data-testid="kiosk-inv-detail-back"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" /> Terug
          </button>
          <button type="button" onClick={onNewInvoice} data-testid="kiosk-inv-detail-new"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-orange-50 px-3 text-sm font-bold text-[#FF5C00] hover:bg-orange-100">
            <FilePlus2 className="h-4 w-4" /> Factuur
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Openstaand</span>
          <span className={`text-lg font-black ${t.amt}`} data-testid="kiosk-inv-detail-total">{money(g.totalDue, g.currency)}</span>
          <CreditBadge amount={credit} currency={g.currency} testId="kiosk-inv-detail-credit" />
        </div>
        <div className="flex flex-wrap gap-2">
          {g.dueCount > 0 && (
            <>
              <button type="button" onClick={() => openPay(g.tenant_id)} data-testid="kiosk-inv-detail-pay"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-4 text-sm font-bold text-white hover:bg-[#E05200]">
                <Banknote className="h-4 w-4" /> Betalen
              </button>
              <button type="button" onClick={() => onRemind(g)} data-testid="kiosk-inv-detail-remind"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-bold text-emerald-700 hover:bg-emerald-100">
                <MessageCircle className="h-4 w-4" /> Herinnering
              </button>
            </>
          )}
          <button type="button" onClick={rebalance} disabled={rebalancing} data-testid="kiosk-inv-detail-rebalance"
            title="Herverdeel alle openstaande tegoeden over openstaande facturen"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-60">
            {rebalancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Tegoed herverdelen
          </button>
        </div>
      </div>
      {rebalanceMsg && <p className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700" data-testid="kiosk-inv-detail-rebalance-msg">{rebalanceMsg}</p>}

      <div className="flex shrink-0 gap-2 overflow-x-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-sm"
        role="tablist" aria-label="Factuurdetails">
        {[
          ['overzicht', 'Overzicht'],
          ['facturen', `Facturen (${rows.length})`],
          ['geschiedenis', `Betalingsgeschiedenis (${paid.length})`],
        ].map(([tabKey, label]) => (
          <button key={tabKey} type="button" role="tab" aria-selected={detailTab === tabKey}
            onClick={() => setDetailTab(tabKey)} data-testid={`kiosk-inv-detail-tab-${tabKey}`}
            className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold transition ${
              detailTab === tabKey ? 'bg-[#FF5C00] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}>{label}</button>
        ))}
      </div>

      {detailTab === 'overzicht' && (
        <div className="grid min-h-0 gap-3 xl:grid-cols-[1.4fr_1fr]" data-testid="kiosk-inv-detail-overview">
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900">Factuuroverzicht</h2>
              <FileSignature className="h-5 w-5 text-[#FF5C00]" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-red-50 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Openstaand</p>
                <p className="mt-1 text-lg font-black text-red-600">{money(g.totalDue, g.currency)}</p>
              </div>
              <div className="rounded-xl bg-orange-50 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Open facturen</p>
                <p className="mt-1 text-lg font-black text-slate-900">{g.open.length}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Totaal facturen</p>
                <p className="mt-1 text-lg font-black text-slate-900">{rows.length}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Tegoed</p>
                <p className="mt-1 text-lg font-black text-emerald-700">{money(credit, g.currency)}</p>
              </div>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900">Huurder</h2>
              <Wallet className="h-5 w-5 text-[#FF5C00]" />
            </div>
            <p className="truncate text-lg font-black text-slate-900">{g.tenant_name || 'Onbekende huurder'}</p>
            <p className="mt-1 truncate text-sm text-slate-500">{tenant?.phone || 'Geen telefoonnummer'}</p>
            <p className="truncate text-sm text-slate-500">{tenant?.email || 'Geen e-mailadres'}</p>
            {g.dueCount > 0 && (
              <button type="button" onClick={() => setDetailTab('facturen')}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-50 px-4 text-sm font-bold text-[#FF5C00] hover:bg-orange-100">
                Bekijk facturen <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </section>
        </div>
      )}

      {detailTab === 'facturen' && (
        <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-100 bg-white px-4 shadow-sm"
          data-testid="kiosk-inv-detail-invoices">
          <div className="divide-y divide-slate-100">
            {rows.map((inv) => <InvoiceLine key={inv.id} inv={inv} open={g.open.includes(inv)}
              onPayInvoice={(invoice) => onPayInvoice(invoice, g)} onDelete={onDelete}
              credit={credit} tenant={tenant} onChanged={onChanged} onMsg={onMsg} />)}
          </div>
          {rows.length === 0 && <p className="py-12 text-center text-sm font-semibold text-slate-500">Geen facturen gevonden.</p>}
        </section>
      )}

      {detailTab === 'geschiedenis' && (
        <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
          data-testid="kiosk-inv-detail-history">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-5 w-5 text-[#FF5C00]" />
            <h2 className="text-base font-black text-slate-900">Betalingsgeschiedenis</h2>
          </div>
          {paid.length
            ? <PaidHistorySection paidInvoices={paid} currency={g.currency} testidPrefix={`kiosk-history-${g.tenant_id}`} />
            : <p className="py-8 text-center text-sm font-semibold text-slate-500">Nog geen betalingen voor deze huurder.</p>}
        </section>
      )}
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
  const [quickPay, setQuickPay] = useState(null);
  const [createTenantId, setCreateTenantId] = useState('');
  const [error, setError] = useState('');
  const [severity, setSeverity] = useState('all');
  const [credits, reloadCredits] = useTenantCredits();

  const load = useCallback(() => {
    api.get('/invoices/grouped', { params: { tab, severity, q: q.trim(), offset: 0, limit: 500 } })
      .then(({ data: d }) => { setData(d); setError(''); })
      .catch((e) => setError(formatError(e, 'Facturen konden niet worden geladen.')));
    reloadCredits();
  }, [tab, q, severity, reloadCredits]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const loadTenants = useCallback(() => {
    api.get('/tenants').then(({ data: d }) => setTenants(d || [])).catch(() => {});
  }, []);
  useEffect(() => { loadTenants(); }, [loadTenants]);
  useEffect(() => {
    const onChange = () => { load(); loadTenants(); };
    const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
    window.addEventListener('surirent:live-change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, loadTenants]);

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
    setBusy(true); setMsg(null); setError('');
    try {
      const { data: d } = await api.post('/invoices/generate-month', { period_month: t.getMonth() + 1, period_year: t.getFullYear() });
      setMsg({ ok: true, text: `${d.created} aangemaakt, ${d.skipped} overgeslagen` });
      load();
    } catch (e) { setMsg({ ok: false, text: formatError(e) }); }
    finally { setBusy(false); }
  };
  const del = async (inv) => {
    if (!(await hostConfirm(`Factuur ${inv.invoice_number} verwijderen?`))) return;
    try {
      await api.delete(`/invoices/${inv.id}`);
      setMsg({ ok: true, text: `Factuur ${inv.invoice_number} verwijderd` });
      load();
    } catch (e) { setMsg({ ok: false, text: formatError(e) }); }
  };

  return (
    <div className="h-full w-full bg-[#FF5C00] flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0"
      style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }} data-testid="kiosk-admin-page-facturen">
      <div className="kiosk-chrome md:hidden flex items-center justify-between gap-2 px-1 sm:px-2 py-2 shrink-0">
        {onBack ? (
          <button onClick={onBack} data-testid="kiosk-admin-page-back"
            className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 active:scale-95 transition">
            <ArrowLeft className="w-4 h-4" /> <span className="text-xs">Terug</span>
          </button>
        ) : <span />}
        <div className="text-right text-white">
          <p className="text-sm font-semibold">Facturen</p>
          <p className="text-[10px] opacity-70">Facturenbeheer</p>
        </div>
      </div>

      {msg && <div role="status" data-testid="kiosk-inv-msg"
        className={`mx-1 mt-1 flex flex-none items-center justify-between gap-3 rounded-xl px-4 py-2 text-sm font-bold sm:mx-2 ${
          msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
        <span>{msg.text}</span>
        <button type="button" onClick={() => setMsg(null)} aria-label="Melding sluiten"><X className="h-4 w-4" /></button>
      </div>}

      <main className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 sm:gap-3 pb-3 md:pt-3 overflow-hidden"
        data-testid="kiosk-inv-list">
        {creating ? (
          <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-white p-4 sm:p-6" data-testid="kiosk-inv-create">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h1 className="text-lg font-black text-slate-900">Nieuwe factuur</h1>
              <button type="button" onClick={() => { setCreating(false); setCreateTenantId(''); }} data-testid="kiosk-inv-create-cancel"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-700 hover:bg-slate-200">
                <ArrowLeft className="h-4 w-4" /> Terug
              </button>
            </div>
            <InvoiceForm inline tenants={tenants} initialTenantId={createTenantId}
              onCancel={() => { setCreating(false); setCreateTenantId(''); }}
              onSaved={(invoice) => {
                setCreating(false);
                setCreateTenantId('');
                setMsg({ ok: true, text: `Factuur ${invoice?.invoice_number || ''} aangemaakt` });
                load();
              }} />
          </section>
        ) : sel ? (
          <section className="min-h-0 flex-1 overflow-y-auto" data-testid="kiosk-inv-detail-panel">
            <div className="mx-auto w-full max-w-7xl">
              <TenantDetail key={sel.tenant_id} g={sel} onBack={() => setSelId(null)} onRemind={setReminding}
                onDelete={del} onPayInvoice={(inv, group) => setQuickPay({ inv, group })}
                onNewInvoice={() => { setCreateTenantId(sel.tenant_id); setCreating(true); }}
                onRebalanced={load} credit={creditOf(credits, sel.tenant_id, sel.currency)}
                tenant={tenants.find((tenantItem) => tenantItem.id === sel.tenant_id)}
                onChanged={load} onMsg={setMsg} />
            </div>
          </section>
        ) : (
          <>
            <section className="order-1 flex shrink-0 flex-col rounded-2xl bg-white p-2.5 sm:p-6 md:order-2 md:flex-[2] md:overflow-y-auto"
              data-testid="kiosk-inv-summary">
              <div className="mb-1 flex items-center justify-between gap-3 sm:mb-4">
                <h1 className="text-base font-black tracking-tight text-slate-900 sm:text-2xl">Facturen</h1>
                <FileSignature className="h-4 w-4 text-[#FF5C00] sm:h-5 sm:w-5" />
              </div>
              <div className="rounded-2xl bg-red-50 p-2.5 sm:p-4">
                <p className="text-[11px] font-semibold text-slate-500 sm:text-sm">Totaal openstaand</p>
                <p className="mt-0.5 break-words text-base font-black text-red-600 tabular-nums sm:mt-1 sm:text-2xl"
                  data-testid="kiosk-inv-stat-open">{money(s.totalOpenAmount || 0, s.currency)}</p>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:mt-3 sm:gap-3">
                <div className="rounded-2xl bg-amber-50 p-2 sm:p-4">
                  <p className="text-[10px] font-bold text-amber-700 sm:text-xs">Achterstand</p>
                  <p className="mt-0.5 text-lg font-black text-amber-800 sm:mt-1 sm:text-2xl" data-testid="kiosk-inv-stat-late">
                    {s.openCount || 0} <span className="text-sm font-bold text-slate-500">/ {s.allCount || 0}</span>
                  </p>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-2 sm:p-4">
                  <p className="text-[10px] font-bold text-slate-500 sm:text-xs">Verwacht {month}</p>
                  <p className="mt-0.5 break-words text-sm font-black text-emerald-700 tabular-nums sm:mt-1 sm:text-lg"
                    data-testid="kiosk-inv-stat-month">{money(s.thisMonthExpected || 0, s.currency)}</p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:mt-4 sm:grid-cols-1 sm:gap-2">
                <button type="button" onClick={generate} disabled={busy} data-testid="kiosk-inv-generate"
                  className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-1 text-[10px] font-bold text-[#FF5C00] transition-colors hover:bg-orange-100 disabled:opacity-60 sm:min-h-11 sm:gap-2 sm:rounded-xl sm:px-3 sm:text-sm">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" /> : <CalendarPlus className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />} Genereer {month}
                </button>
                <button type="button" onClick={() => { setCreateTenantId(''); setCreating(true); }}
                  data-testid="kiosk-inv-new"
                  className="inline-flex min-h-9 w-full items-center justify-center gap-1 rounded-lg bg-[#FF5C00] px-1 text-[10px] font-black text-white shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)] transition-colors hover:bg-[#E05200] sm:h-12 sm:gap-2 sm:rounded-2xl sm:px-3 sm:text-sm">
                  <FilePlus2 className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" /> Nieuwe factuur
                </button>
              </div>
              {onBack && (
                <button type="button" onClick={onBack} data-testid="kiosk-inv-back-desktop"
                  className="mt-2 hidden min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50 md:inline-flex">
                  <ArrowLeft className="h-4 w-4" /> Terug
                </button>
              )}
              {error && <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" data-testid="kiosk-inv-error">{error}</div>}
              {!data && !error && <Loader2 className="mx-auto my-5 h-6 w-6 animate-spin text-[#FF5C00]" />}
            </section>

            <section className="order-2 flex min-h-0 min-w-0 flex-[3] flex-col overflow-hidden rounded-2xl bg-white p-2 sm:p-5 md:order-1"
              data-testid="kiosk-inv-recent">
              <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3 sm:gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-black tracking-tight text-slate-900 sm:text-xl">Alle huurders</h2>
                  <p className="text-xs font-semibold text-slate-500">Facturen per huurder</p>
                </div>
                <span className="shrink-0 rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{groups.length} huurders</span>
              </div>
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:mb-3 sm:gap-2 sm:pb-1" role="tablist" aria-label="Factuurstatus">
                {TABS.map((filter) => (
                  <button key={filter.v} type="button" role="tab" aria-selected={tab === filter.v}
                    onClick={() => setTab(filter.v)} data-testid={`kiosk-inv-tab-${filter.v}`}
                    className={`shrink-0 rounded-xl px-2.5 py-1.5 text-[11px] font-bold transition-colors sm:px-3 sm:py-2 sm:text-xs ${
                      tab === filter.v ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                    {filter.label} ({s[filter.key] ?? 0})
                  </button>
                ))}
              </div>
              <label className="relative mb-2 block shrink-0 sm:mb-3">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(event) => setQ(event.target.value)}
                  placeholder="Zoek huurder of appartement…" data-testid="kiosk-inv-search"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-xs font-medium outline-none focus:border-[#FF5C00] sm:h-11 sm:text-sm" />
                {q && <button type="button" onClick={() => setQ('')} aria-label="Wissen" className="absolute right-3 top-1/2 -translate-y-1/2"><X className="h-4 w-4 text-slate-400" /></button>}
              </label>
              <div className="mb-2 sm:mb-3"><SeverityPills value={severity} onChange={setSeverity} testPrefix="kiosk-inv" /></div>
              <div className="flex-1 min-h-0 space-y-1.5 overflow-y-auto -mx-1 px-1 sm:space-y-2">
                {error && data && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
                {!data && !error && <Loader2 className="mx-auto my-8 h-7 w-7 animate-spin text-[#FF5C00]" />}
                {groups.map((group) => (
                  <TenantTile key={group.tenant_id} g={group} credit={creditOf(credits, group.tenant_id, group.currency)}
                    onOpen={(value) => setSelId(value.tenant_id)} onRemind={setReminding} />
                ))}
                {data && !error && groups.length === 0 && (
                  <p className="rounded-2xl bg-slate-50 py-12 text-center text-sm font-semibold text-slate-500" data-testid="kiosk-inv-empty">
                    Geen facturen gevonden.
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
      {quickPay && <QuickPayModal invoice={quickPay.inv} tenantName={quickPay.group.tenant_name}
        tenantPhone={quickPay.group.tenant_phone || ''} otherOpenInvoices={quickPay.group.open.filter((inv) => inv.id !== quickPay.inv.id)}
        onClose={() => setQuickPay(null)} onSuccess={() => { setQuickPay(null); load(); }} />}
      {reminding && <ReminderModal group={reminding} onClose={() => setReminding(null)} onSent={() => setReminding(null)} />}
    </div>
  );
}
