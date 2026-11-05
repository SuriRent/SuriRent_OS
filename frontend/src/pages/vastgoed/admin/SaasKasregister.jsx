// SaaS Kasregister — Superadmin
// -----------------------------------------------------------------------------
// Een dashboard-overzicht voor de SaaS-eigenaar: welk bedrijf heeft betaald,
// wie moet nog, en directe knoppen om een factuur te openen of een betaling
// te registreren. Vervangt de huurder-kiosk voor superadmin-gebruikers.
//
// Data-bron: GET /api/superadmin/kasregister → { companies: [...], totals: {...} }
// Refreshed elke 15s.
// -----------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Crown, Building2, CheckCircle, Clock, AlertCircle, ArrowLeft,
  RefreshCw, Loader2, Receipt, Banknote, Plus, X, Download, Mail,
} from 'lucide-react';
import { api, fmtMoney, formatError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const STATUS_META = {
  overdue: { label: 'Achterstand', bg: 'bg-red-100', text: 'text-red-700', icon: AlertCircle, tone: 'from-red-500 to-red-700' },
  open:    { label: 'Open',        bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock, tone: 'from-amber-500 to-amber-600' },
  paid:    { label: 'Betaald',     bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle, tone: 'from-emerald-500 to-emerald-700' },
  trial:   { label: 'Proefperiode', bg: 'bg-sky-100', text: 'text-sky-700', icon: Clock, tone: 'from-sky-500 to-blue-700' },
  unbilled:{ label: 'Nog geen factuur', bg: 'bg-slate-100', text: 'text-slate-600', icon: Receipt, tone: 'from-slate-500 to-slate-700' },
};

export default function SaasKasregister() {
  const nav = useNavigate();
  const { activeCompanyId } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [detailCid, setDetailCid] = useState(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setLoadError('');
    try {
      const { data: d } = await api.get('/superadmin/kasregister');
      setData(d);
    } catch (e) {
      setLoadError(formatError(e, 'Kasregister kon niet worden geladen.'));
    }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" data-testid="kasregister-loading">
        <Loader2 className="h-8 w-8 animate-spin text-[#FF5C00]" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4" data-testid="kasregister-error">
        <div className="max-w-md text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <p className="font-bold text-slate-800">{loadError || 'Kasregister kon niet worden geladen.'}</p>
          <button onClick={load} disabled={refreshing} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#FF5C00] px-4 py-2 font-bold text-white disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Opnieuw proberen
          </button>
        </div>
      </div>
    );
  }

  const companies = data.companies || [];
  const scopedCompanies = activeCompanyId
    ? companies.filter((company) => company.id === activeCompanyId)
    : companies;
  const filtered = statusFilter === 'all' ? scopedCompanies : scopedCompanies.filter((c) => c.status === statusFilter);
  const totals = scopedCompanies.reduce((counts, company) => {
    if (Object.prototype.hasOwnProperty.call(counts, company.status)) counts[company.status] += 1;
    return counts;
  }, { overdue: 0, open: 0, paid: 0, trial: 0, unbilled: 0 });
  const grandTotalPerCurrency = scopedCompanies.reduce((acc, c) => {
    for (const [cur, v] of Object.entries(c.outstanding_by_currency || {})) {
      acc[cur] = (acc[cur] || 0) + v;
    }
    return acc;
  }, {});

  return (
    <div className="w-full min-w-0 space-y-4 text-slate-900" data-testid="saas-kasregister">
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => nav('/admin/saas_overview')} data-testid="kasregister-back"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-orange-200 hover:text-[#FF5C00]">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#FF5C00]">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#FF5C00]">Financiën</p>
              <h1 className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">Kasregister per bedrijf</h1>
            </div>
          </div>
          <button onClick={load} disabled={refreshing} data-testid="kasregister-refresh"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-orange-200 hover:text-[#FF5C00] disabled:opacity-50 sm:w-auto sm:gap-2 sm:px-4">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden text-sm font-bold sm:inline">Vernieuwen</span>
          </button>
        </div>
        <p className="ml-[104px] mt-1 text-xs text-slate-500">Controleer abonnementen, betalingen en openstaande bedragen.</p>
      </div>

      <div className="space-y-4">
        {loadError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <span>{loadError}</span>
            <button onClick={load} disabled={refreshing} className="shrink-0 font-bold underline disabled:opacity-50">Opnieuw laden</button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <StatusCard status="overdue" count={totals.overdue} active={statusFilter === 'overdue'}
            onClick={() => setStatusFilter(statusFilter === 'overdue' ? 'all' : 'overdue')} />
          <StatusCard status="open" count={totals.open} active={statusFilter === 'open'}
            onClick={() => setStatusFilter(statusFilter === 'open' ? 'all' : 'open')} />
          <StatusCard status="paid" count={totals.paid} active={statusFilter === 'paid'}
            onClick={() => setStatusFilter(statusFilter === 'paid' ? 'all' : 'paid')} />
          <StatusCard status="trial" count={totals.trial} active={statusFilter === 'trial'}
            onClick={() => setStatusFilter(statusFilter === 'trial' ? 'all' : 'trial')} />
          <StatusCard status="unbilled" count={totals.unbilled} active={statusFilter === 'unbilled'}
            onClick={() => setStatusFilter(statusFilter === 'unbilled' ? 'all' : 'unbilled')} />
        </div>

        {/* Totaal openstaand */}
        {Object.keys(grandTotalPerCurrency).length > 0 && (
          <div className="rounded-2xl border border-orange-100 bg-[#FFF7F1] p-4"
            data-testid="grand-total">
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-orange-700">
              Totaal openstaand
            </p>
            <div className="flex items-baseline gap-4 flex-wrap">
              {Object.entries(grandTotalPerCurrency).map(([cur, v]) => (
                <p key={cur} className="text-2xl font-black tracking-tight">
                  <span className="text-sm opacity-60 mr-1">{cur}</span>
                  {Math.round(v).toLocaleString('nl-NL')}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Bedrijven grid */}
        {filtered.length === 0 ? (
          <div className="rounded-3xl border border-slate-100 bg-white p-12 text-center shadow-sm" data-testid="kasregister-empty">
            <CheckCircle className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
            <p className="text-lg font-black text-slate-900">Niets te tonen voor deze filter</p>
            <p className="mt-1 text-sm text-slate-500">
              {statusFilter === 'paid' ? 'Geen betaalde bedrijven.' :
                statusFilter === 'open' ? 'Alle open facturen zijn opgevolgd — mooi!' :
                statusFilter === 'overdue' ? 'Geen achterstanden. 🎉' : 'Nog geen bedrijven met facturen.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="companies-grid">
            {filtered.map((c) => (
              <CompanyKioskCard key={c.id} company={c}
                onOpenDetail={() => setDetailCid(c.id)} />
            ))}
          </div>
        )}

        {/* Snelle acties onderaan */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button onClick={() => nav('/admin/saas_invoices')}
            className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:border-orange-200"
            data-testid="quick-invoices">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50">
              <Receipt className="h-5 w-5 text-[#FF5C00]" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">Facturen</p>
              <p className="text-sm font-black text-slate-900">Bekijk alle</p>
            </div>
          </button>
          <button onClick={() => nav('/admin/saas_payments')}
            className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:border-orange-200"
            data-testid="quick-payments">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
              <Banknote className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">Betalingen</p>
              <p className="text-sm font-black text-slate-900">Bekijk</p>
            </div>
          </button>
          <button onClick={() => nav('/admin/saas_kasgeld')}
            className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:border-orange-200"
            data-testid="quick-kasgeld">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50">
              <Building2 className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">Kasgeld</p>
              <p className="text-sm font-black text-slate-900">Mutaties</p>
            </div>
          </button>
          <button onClick={() => nav('/admin/saas_payment_plans')}
            className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:border-orange-200"
            data-testid="quick-plans">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50">
              <Plus className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">Regeling</p>
              <p className="text-sm font-black text-slate-900">Maak nieuwe</p>
            </div>
          </button>
        </div>
      </div>

      {/* Detail drawer */}
      {detailCid && (
        <CompanyDetailDrawer cid={detailCid} onClose={() => setDetailCid(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusCard — grote statistiek-tegel per status (klikbaar → filter)
// ---------------------------------------------------------------------------
function StatusCard({ status, count, active, onClick }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <button onClick={onClick} data-testid={`status-card-${status}`}
      className={`relative overflow-hidden rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:shadow-md sm:p-5 ${
        active ? 'border-orange-300 ring-2 ring-orange-100' : 'border-slate-100 hover:border-orange-200'
      }`}>
      <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${meta.tone}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <p className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl" data-testid={`status-count-${status}`}>{count}</p>
      <p className="mt-0.5 text-xs font-bold text-slate-500 sm:text-sm">{meta.label}</p>
      {active && (
        <div className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#FF5C00]" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CompanyKioskCard — kiosk-tegel per bedrijf met status + snelle acties
// ---------------------------------------------------------------------------
function CompanyKioskCard({ company: c, onOpenDetail }) {
  const meta = STATUS_META[c.status] || STATUS_META.paid;
  const Icon = meta.icon;
  return (
    <div className={`cursor-pointer overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
      c.status === 'overdue' ? 'border-red-200' :
      c.status === 'open' ? 'border-amber-200' :
      c.status === 'trial' ? 'border-sky-200' :
      c.status === 'unbilled' ? 'border-slate-200' :
      'border-emerald-200'
    }`}
      onClick={onOpenDetail}
      data-testid={`company-card-${c.id}`}>
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-black tracking-tight text-slate-900" data-testid={`company-name-${c.id}`}>{c.name}</p>
            <p className="truncate font-mono text-[10px] text-slate-500">/{c.slug} · {c.plan || 'geen plan'}</p>
          </div>
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${meta.bg} ${meta.text}`}
            data-testid={`company-status-${c.id}`}>
            <Icon className="w-3 h-3" />
            {meta.label}
          </span>
        </div>

        {/* Outstanding */}
        <div className="mb-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Openstaand</p>
          {Object.keys(c.outstanding_by_currency || {}).length === 0 ? (
            <p className={`mt-1 text-lg font-black ${c.status === 'paid' ? 'text-emerald-600' : 'text-slate-600'}`}>
              {c.status === 'trial' ? 'Proefperiode actief' :
                c.status === 'unbilled' ? 'Nog geen factuur' :
                  c.status === 'overdue' ? 'Betaling vereist' : '✓ Voldaan'}
            </p>
          ) : (
            <div className="flex items-baseline gap-3 flex-wrap mt-1">
              {Object.entries(c.outstanding_by_currency).map(([cur, v]) => (
                <p key={cur} className="text-xl font-black tracking-tight text-slate-900">
                  <span className="mr-1 text-xs text-slate-400">{cur}</span>
                  {Math.round(v).toLocaleString('nl-NL')}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Meta info */}
        <div className="mb-4 grid grid-cols-3 gap-2 border-b border-slate-100 pb-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Open</p>
            <p className="text-lg font-black text-slate-900" data-testid={`company-open-${c.id}`}>{c.open_count}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Vervallen</p>
            <p className={`text-lg font-black ${c.overdue_count > 0 ? 'text-red-600' : 'text-slate-900'}`}>{c.overdue_count}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Betaald</p>
            <p className="text-lg font-black text-emerald-600">{c.paid_count}</p>
          </div>
        </div>

        {/* Last payment */}
        {c.last_payment && (
          <p className="mb-3 text-[11px] text-slate-500">
            Laatste betaling: <span className="font-mono font-bold text-slate-700">{fmtMoney(c.last_payment.amount, c.last_payment.currency)}</span> · {(c.last_payment.paid_at || '').slice(0, 10)}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={onOpenDetail} data-testid={`open-invoices-${c.id}`}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 transition hover:border-orange-200 hover:bg-orange-50">
            <Receipt className="w-3.5 h-3.5" /> Details
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompanyDetailDrawer — Slide-in drawer met alle facturen + betaalhistorie
// van 1 bedrijf. Elke factuur heeft PDF-download + e-mail knop.
// ---------------------------------------------------------------------------
function CompanyDetailDrawer({ cid, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data: d } = await api.get(`/superadmin/kasregister/${cid}`);
        setData(d);
      } catch (e) { setErr(formatError(e)); }
      finally { setLoading(false); }
    })();
  }, [cid]);

  const dl = async (invId) => {
    try {
      const res = await api.get(`/superadmin/subscription-invoices/${invId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { window.alert('PDF fout: ' + formatError(e)); }
  };

  const mail = async (invId, defaultTo) => {
    const to = window.prompt(`Verstuur factuur naar? (Enter = ${defaultTo || 'eigenaar'})`, '');
    if (to === null) return;
    try {
      await api.post(`/superadmin/subscription-invoices/${invId}/email`,
        to.trim() ? { to_email: to.trim() } : {});
      window.alert('✓ Verstuurd');
    } catch (e) { window.alert('Mail fout: ' + formatError(e)); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="kasregister-drawer">
      <div className="absolute inset-0 bg-slate-900/35 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white text-slate-900 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur-xl">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#FF5C00]">Bedrijf detail</p>
            <h2 className="text-lg font-black text-slate-900" data-testid="drawer-company-name">{data?.company?.name || 'Laden…'}</h2>
          </div>
          <button onClick={onClose} data-testid="drawer-close"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-orange-200 hover:text-[#FF5C00]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {loading && <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin text-[#FF5C00]" /></div>}
          {err && <p className="text-sm text-red-600">{err}</p>}

          {data && (
            <>
              {/* Meta */}
              <div className="grid grid-cols-2 gap-3">
                <MetaTile label="Plan" value={data.company.plan || '—'} />
                <MetaTile label="Status" value={data.company.billing_status} />
                <MetaTile label="Eigenaar" value={data.company.owner_email || '—'} />
                <MetaTile label="Verlengt" value={(data.company.subscription_renews_at || '').slice(0, 10) || '—'} />
              </div>

              {/* Openstaand */}
              {Object.keys(data.outstanding_by_currency || {}).length > 0 && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-red-600">Openstaand totaal</p>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    {Object.entries(data.outstanding_by_currency).map(([cur, v]) => (
                      <p key={cur} className="text-2xl font-black text-slate-900">
                        <span className="mr-1 text-xs text-slate-500">{cur}</span>{Math.round(v).toLocaleString('nl-NL')}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Facturen */}
              <section>
                <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Facturen ({data.invoices.length})
                </p>
                {data.invoices.length === 0 ? (
                  <p className="text-sm text-slate-400">Geen facturen.</p>
                ) : (
                  <div className="space-y-2">
                    {data.invoices.map((inv) => (
                      <div key={inv.id} data-testid={`drawer-inv-${inv.id}`}
                        className={`rounded-xl p-3 border ${
                          inv.status === 'paid' ? 'bg-emerald-500/5 border-emerald-400/20'
                            : inv.status === 'overdue' ? 'bg-red-500/5 border-red-400/20'
                            : inv.status === 'superseded' ? 'bg-slate-500/5 border-slate-400/20 opacity-60'
                            : 'bg-slate-50 border-slate-200'
                        }`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="min-w-0 flex-1">
                            <p className="font-black text-sm truncate">
                              INV-{inv.id.slice(0, 8).toUpperCase()}
                              {inv.kind === 'installment' && (
                                <span className="ml-2 text-[10px] font-bold text-orange-300">T{inv.installment_seq}/{inv.installment_total}</span>
                              )}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {(inv.period_start || '').slice(0, 10)} → {(inv.period_end || '').slice(0, 10)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-black">{fmtMoney(inv.amount, inv.currency)}</p>
                            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              inv.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                                : inv.status === 'overdue' ? 'bg-red-100 text-red-700'
                                : inv.status === 'superseded' ? 'bg-slate-100 text-slate-500'
                                : 'bg-amber-100 text-amber-700'
                            }`}>{inv.status}</span>
                          </div>
                        </div>
                        <div className="flex gap-1.5 mt-2">
                          <button onClick={() => dl(inv.id)} data-testid={`drawer-pdf-${inv.id}`}
                            className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700 transition hover:bg-slate-50">
                            <Download className="w-3 h-3" /> PDF
                          </button>
                          <button onClick={() => mail(inv.id, data.company.owner_email)} data-testid={`drawer-mail-${inv.id}`}
                            className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-sky-50 text-[11px] font-bold text-sky-700 transition hover:bg-sky-100">
                            <Mail className="w-3 h-3" /> Mail
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Betalingen */}
              <section>
                <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Betalingen ({data.payments.length})
                </p>
                {data.payments.length === 0 ? (
                  <p className="text-sm text-slate-400">Nog geen betalingen ontvangen.</p>
                ) : (
                  <div className="space-y-2">
                    {data.payments.map((p) => (
                      <div key={p.id} data-testid={`drawer-pmt-${p.id}`}
                        className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                          <Banknote className="h-4 w-4 text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-slate-900">{p.method || 'Betaling'}</p>
                          <p className="truncate font-mono text-[11px] text-slate-500">
                            {(p.paid_at || '').slice(0, 10)} · {p.reference || p.note || '—'}
                          </p>
                        </div>
                        <p className={`font-black ${Number(p.amount) < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                          {Number(p.amount) < 0 ? '−' : ''}{fmtMoney(Math.abs(p.amount), p.currency)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Regelingen */}
              {data.plans.length > 0 && (
                <section>
                  <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
                    Betalingsregelingen ({data.plans.length})
                  </p>
                  <div className="space-y-2">
                    {data.plans.map((pl) => (
                      <div key={pl.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <p className="text-sm font-black text-slate-900">{pl.installments} termijnen · {fmtMoney(pl.total_amount, pl.currency)}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">Start: {(pl.start_date || '').slice(0, 10)} · elke {pl.interval_days} dagen</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}
