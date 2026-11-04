// Superadmin · SaaS Overzicht
// Platformstatistieken en live bedrijfsactiviteit; refresht elke 15 seconden.
// -----------------------------------------------------------------------------

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Crown, TrendingUp, Building2, Clock, AlertCircle, Wifi, WifiOff,
  ScanLine, Receipt, RefreshCw, Loader2, ArrowRight, Trash2, FileText, Briefcase,
} from 'lucide-react';
import { api, formatError, fmtMoney } from '../../../lib/api';

const fmtRelative = (iso) => {
  if (!iso) return 'nooit ingelogd';
  try {
    const ts = new Date(iso).getTime();
    const diff = Math.max(0, (Date.now() - ts) / 1000);
    if (diff < 60) return `${Math.floor(diff)}s geleden`;
    if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} u geleden`;
    return `${Math.floor(diff / 86400)} dgn geleden`;
  } catch {
    return '—';
  }
};

const STATUS_PILL = {
  trial: 'bg-sky-50 text-sky-700 ring-sky-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  expired: 'bg-red-50 text-red-700 ring-red-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-200',
  past_due: 'bg-amber-50 text-amber-700 ring-amber-200',
};
const STATUS_LABEL = {
  trial: 'Proef', active: 'Actief', expired: 'Verlopen', cancelled: 'Opgezegd', past_due: 'Open',
};
const billingLabel = (company) => {
  if (company.access_restricted) return 'Beperkte toegang';
  if (company.billing_status === 'expired') return `Respijt · ${company.grace_days_left ?? '—'}d`;
  return STATUS_LABEL[company.billing_status] || company.billing_status;
};

// PageHeader — identieke opmaak als in AdminDashboard.jsx (regel 850).
function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-start sm:items-end justify-between gap-3 mb-4 sm:mb-6 min-w-0">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-slate-900 tracking-tight break-words">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export default function SaasOverview() {
  const [overview, setOverview] = useState(null);
  const [presence, setPresence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const requestInFlight = useRef(false);

  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);
    try {
      const [overviewResult, presenceResult] = await Promise.allSettled([
        api.get('/superadmin/overview'),
        api.get('/superadmin/online-status'),
      ]);
      const failures = [];
      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value.data || {});
      else failures.push(`Platformgegevens: ${formatError(overviewResult.reason)}`);
      if (presenceResult.status === 'fulfilled') setPresence(presenceResult.value.data || {});
      else failures.push(`Online status: ${formatError(presenceResult.reason)}`);
      setErr(failures.join(' · '));
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
      requestInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !overview && !presence) {
    return (
      <div className="py-20 flex items-center justify-center" data-testid="saas-overview-loading">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  const overviewData = overview || {};
  const companies = presence?.companies || [];
  const hasOverview = overview !== null;
  const hasPresence = presence !== null;
  const onlineCompanies = companies.filter((c) => c.online);
  const offlineCompanies = companies.filter((c) => !c.online);
  const trialActive = companies.filter((c) => c.billing_status === 'trial');
  const trialExpiring = trialActive.filter((c) => {
    if (!c.trial_ends_at) return false;
    const end = new Date(c.trial_ends_at).getTime();
    const days = (end - Date.now()) / 86400000;
    return days >= 0 && days <= 3;
  });

  // ===== Afgeleide metrics — spiegelen 1:1 de beheerder-Overzicht =====
  const receivedByCur = overviewData.total_received_by_currency || {};
  const openByCur = overviewData.current_month_open_by_currency || {};
  const primaryCur = Object.keys(openByCur)[0] || Object.keys(receivedByCur)[0] || 'SRD';
  const currentMonthOpenCount = overviewData.current_month_open_count || 0;
  const currentOpenTotal = openByCur[primaryCur] || 0;

  const companiesTotal = overviewData.companies_total || 0;
  const activeCount = overviewData.active || 0;
  const trialCount = overviewData.trial || 0;
  const overdueCount = overviewData.overdue_invoices || 0;
  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-5" data-testid="saas-overview-page">
      <PageHeader
        title="Overzicht"
        subtitle="Snelle blik op uw platform · bedrijven, abonnementen en inkomsten"
        action={
          <button onClick={load} disabled={refreshing} data-testid="saas-overview-refresh"
            className="h-10 w-10 sm:w-auto sm:px-4 rounded-xl bg-white border border-slate-200 hover:border-orange-300 text-sm font-bold text-slate-700 flex items-center justify-center gap-2 disabled:opacity-50"
            aria-label="Overzicht vernieuwen">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Vernieuwen</span>
          </button>
        }
      />

      {err && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900" role="alert">
          <span>{err}</span>
          <button type="button" onClick={load} disabled={refreshing} data-testid="saas-overview-retry"
            className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-amber-900 border border-amber-200 disabled:opacity-50">
            Opnieuw proberen
          </button>
        </div>
      )}

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)]" data-testid="saas-platform-summary">
        <div className="relative overflow-hidden rounded-3xl border border-orange-100 bg-white p-5 shadow-sm sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-orange-50" />
          <div className="relative">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-[#FF5C00]"><Crown className="h-4 w-4" /></span>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FF5C00]">Platform</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Beheer je platform</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">Bedrijven, abonnementen en inkomsten op één centrale plek.</p>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { id: 'companies', label: 'Bedrijven', value: companiesTotal, icon: Building2, tone: 'text-[#FF5C00] bg-orange-50' },
                { id: 'active', label: 'Actief', value: activeCount, icon: TrendingUp, tone: 'text-emerald-600 bg-emerald-50' },
                { id: 'trial', label: 'Proefperiode', value: trialCount, icon: Clock, tone: 'text-amber-600 bg-amber-50' },
                { id: 'online', label: 'Online nu', value: overviewData.online_now || 0, icon: Wifi, tone: 'text-sky-600 bg-sky-50' },
              ].map(({ id, label, value, icon: Icon, tone }) => (
                <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                  <span className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></span>
                  <p className="text-2xl font-black tracking-tight text-slate-900" data-testid={`saas-platform-${id}`}>{hasOverview ? value : '—'}</p>
                  <p className="text-xs font-semibold text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-[#FFF7F1] p-5 sm:p-6" data-testid="saas-revenue-summary">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-700">Inkomsten</p>
              <h3 className="mt-1 text-lg font-black text-slate-900">Totaal ontvangen</h3>
              <p className="text-xs text-slate-500">Betaalde abonnementen</p>
            </div>
            <button onClick={() => window.dispatchEvent(new CustomEvent('saas-nav', { detail: 'saas_invoices' }))}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#FF5C00] shadow-sm transition hover:bg-orange-100"
              aria-label="Bekijk facturen" data-testid="saas-hero-cash-cta">
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-5 space-y-2">
            {[
              { cur: 'SRD', label: 'Surinaamse dollar', symbol: '' },
              { cur: 'EUR', label: 'Euro', symbol: '€' },
              { cur: 'USD', label: 'Amerikaanse dollar', symbol: '$' },
            ].map(({ cur, label, symbol }) => (
              <div key={cur} className="flex items-center justify-between gap-3 rounded-xl border border-orange-100/80 bg-white/80 px-3 py-2.5"
                data-testid={`saas-hero-cash-tile-${cur.toLowerCase()}`}>
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-800">{cur}</p>
                  <p className="truncate text-[10px] text-slate-500">{label}</p>
                </div>
                <p className="shrink-0 text-lg font-black text-slate-900" data-testid={`saas-kpi-cash-${cur.toLowerCase()}`}>
                  {symbol}{hasOverview ? Math.round(receivedByCur[cur] || 0).toLocaleString('nl-NL') : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Abonnementsstatus">
        <button onClick={() => window.dispatchEvent(new CustomEvent('saas-nav', { detail: 'companies' }))}
          className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:border-orange-200 hover:shadow-md"
          data-testid="saas-kpi-companies">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#FF5C00]"><Building2 className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-slate-500">Bedrijven</span>
            <span className="block text-2xl font-black text-slate-900">{hasOverview ? companiesTotal : '—'}</span>
            <span className="block truncate text-[11px] font-semibold text-slate-500">{hasOverview ? `${activeCount} actief · ${trialCount} proef` : 'Status niet beschikbaar'}</span>
          </span>
          <ArrowRight className="h-4 w-4 text-slate-300" />
        </button>
        <button onClick={() => window.dispatchEvent(new CustomEvent('saas-nav', { detail: 'saas_invoices' }))}
          className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:border-orange-200 hover:shadow-md"
          data-testid="saas-kpi-current-open">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><Receipt className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-slate-500">Open deze maand</span>
            <span className="block text-2xl font-black text-slate-900">{hasOverview ? currentMonthOpenCount : '—'}</span>
            <span className="block truncate text-[11px] font-semibold text-slate-500">{!hasOverview ? 'Niet beschikbaar' : currentOpenTotal > 0 ? fmtMoney(currentOpenTotal, primaryCur) : 'Geen open bedrag'}</span>
          </span>
          <ArrowRight className="h-4 w-4 text-slate-300" />
        </button>
        <button onClick={() => window.dispatchEvent(new CustomEvent('saas-nav', { detail: 'saas_invoices' }))}
          className={`flex items-center gap-4 rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:shadow-md ${overdueCount ? 'border-red-200 hover:border-red-300' : 'border-slate-100 hover:border-emerald-200'}`}
          data-testid="saas-kpi-overdue">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${overdueCount ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}><AlertCircle className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-slate-500">Achterstand</span>
            <span className="block text-2xl font-black text-slate-900">{hasOverview ? overdueCount : '—'}</span>
            <span className={`block truncate text-[11px] font-semibold ${overdueCount ? 'text-red-600' : 'text-emerald-600'}`}>{!hasOverview ? 'Niet beschikbaar' : overdueCount ? 'Facturen te laat' : 'Alles op tijd'}</span>
          </span>
          <ArrowRight className="h-4 w-4 text-slate-300" />
        </button>
      </section>

      <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">Snel naar</h2>
          <span className="text-[11px] font-medium text-slate-400">Veelgebruikte onderdelen</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { id: 'saas_invoices', title: 'Facturen', detail: 'Abonnementen en facturen', icon: FileText, tone: 'bg-orange-50 text-[#FF5C00]' },
            { id: 'companies', title: 'Bedrijven', detail: 'Bedrijven beheren', icon: Briefcase, tone: 'bg-sky-50 text-sky-600' },
            { id: 'saas_pending', title: `OCR (${hasOverview ? overviewData.pending_ocr || 0 : '—'})`, detail: overviewData.pending_ocr > 0 ? 'Wacht op keuring' : 'Alles goedgekeurd', icon: ScanLine, tone: 'bg-violet-50 text-violet-600' },
          ].map(({ id, title, detail, icon: Icon, tone }) => (
            <button key={id} onClick={() => window.dispatchEvent(new CustomEvent('saas-nav', { detail: id }))}
              className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition hover:border-orange-200 hover:bg-orange-50/40"
              data-testid={`saas-quick-${id}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-black text-slate-900">{title}</span>
                <span className="block truncate text-[11px] font-medium text-slate-500">{detail}</span>
              </span>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-300" />
            </button>
          ))}
        </div>
      </section>

      {/* ===================================================================
          SaaS-specifieke live-widgets (blijven onder de KPI-rij staan)
          =================================================================== */}

      {/* Online bedrijven — live presence */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_-2px_rgba(15,23,42,0.06)] overflow-hidden" data-testid="online-section">
        <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <h2 className="font-extrabold text-sm sm:text-base text-slate-900">Nu online · {hasPresence ? onlineCompanies.length : '—'}</h2>
          </div>
          <p className="text-[11px] text-slate-400 font-mono">Drempel: 5 min</p>
        </div>
        {!hasPresence ? (
          <div className="px-5 py-10 text-center text-amber-700 text-sm" role="status">
        Online gegevens zijn niet beschikbaar. Vernieuw het overzicht om opnieuw te proberen.
          </div>
        ) : onlineCompanies.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-400 text-sm" data-testid="no-online">
            <WifiOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
            Op dit moment is niemand online.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {onlineCompanies.map((c) => (
              <div key={c.id} className="px-3 sm:px-5 py-3 flex items-center gap-2 sm:gap-3 min-w-0" data-testid={`online-row-${c.id}`}>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 truncate">{c.name}</p>
                  <p className="text-xs text-slate-500 font-mono truncate">/{c.slug}</p>
                  <span className={`sm:hidden inline-flex mt-1 text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ring-inset ${STATUS_PILL[c.billing_status] || STATUS_PILL.active}`}>
                    {billingLabel(c)}
                  </span>
                </div>
                <div className="hidden sm:flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ring-inset ${STATUS_PILL[c.billing_status] || STATUS_PILL.active}`}>
                    {billingLabel(c)}
                  </span>
                  {c.active_users > 0 && (
                    <span className="text-[10px] font-bold text-slate-500">{c.active_users} user{c.active_users === 1 ? '' : 's'}</span>
                  )}
                </div>
                <p className="text-[10px] sm:text-[11px] text-slate-500 shrink-0 font-mono max-w-[5.5rem] sm:max-w-none truncate text-right">{fmtRelative(c.last_seen_at)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Trial verloopt bijna */}
      {trialExpiring.length > 0 && (
        <section className="bg-amber-50 rounded-2xl border-2 border-amber-200 overflow-hidden" data-testid="trial-expiring-section">
          <div className="px-3 sm:px-5 py-3 border-b border-amber-200 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-700 shrink-0" />
            <h2 className="font-extrabold text-sm sm:text-base text-amber-900">Proefperiode verloopt binnen 3 dagen · {trialExpiring.length}</h2>
          </div>
          <div className="divide-y divide-amber-100">
            {trialExpiring.map((c) => {
              const end = new Date(c.trial_ends_at);
              const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
              return (
                <div key={c.id} className="px-3 sm:px-5 py-3 flex items-center gap-3" data-testid={`trial-expiring-row-${c.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 truncate">{c.name}</p>
                    <p className="text-xs text-slate-500 font-mono truncate">/{c.slug}</p>
                  </div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                    {days === 0 ? 'Vandaag' : `${days}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent gezien (offline) */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_-2px_rgba(15,23,42,0.06)] overflow-hidden" data-testid="offline-section">
        <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-1">
          <h2 className="font-extrabold text-sm sm:text-base text-slate-900">Recent gezien · {hasPresence ? offlineCompanies.length : '—'}</h2>
          <p className="text-[10px] sm:text-[11px] text-slate-400">gesorteerd op laatst actief</p>
        </div>
        {!hasPresence ? (
          <div className="px-5 py-8 text-center text-amber-700 text-sm" role="status">
            Activiteitsgegevens zijn niet beschikbaar.
          </div>
        ) : <div className="divide-y divide-slate-100">
          {offlineCompanies.slice(0, 10).map((c) => (
            <div key={c.id} className="px-3 sm:px-5 py-3 flex items-center gap-2 sm:gap-3 min-w-0" data-testid={`offline-row-${c.id}`}>
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-900 truncate">{c.name}</p>
                <p className="text-xs text-slate-500 font-mono truncate">/{c.slug}</p>
                <span className={`sm:hidden inline-flex mt-1 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full ring-1 ring-inset ${STATUS_PILL[c.billing_status] || STATUS_PILL.active}`}>
                  {billingLabel(c)}
                </span>
              </div>
              <span className={`hidden sm:inline-flex text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded-full ring-1 ring-inset ${STATUS_PILL[c.billing_status] || STATUS_PILL.active}`}>
                {billingLabel(c)}
              </span>
              <p className="text-[10px] sm:text-[11px] text-slate-500 shrink-0 font-mono w-20 sm:w-24 truncate text-right">{fmtRelative(c.last_seen_at)}</p>
            </div>
          ))}
          {offlineCompanies.length === 0 && (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">Alle bedrijven zijn online! 🎉</div>
          )}
          {offlineCompanies.length > 10 && (
            <div className="px-5 py-3 text-center">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('saas-nav', { detail: 'companies' }))}
                className="text-sm font-bold text-orange-600 hover:text-orange-700 inline-flex items-center gap-1"
                data-testid="see-all-companies">
                Bekijk alle {companies.length} bedrijven <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>}
      </section>

      {/* Danger Zone — volledige database reset (behoud alleen Demo + superadmins) */}
      <DangerZone onDone={load} />
    </div>
  );
}

// =====================================================================
// DangerZone — knop om ALLE bedrijven + hun data te wissen. Vereist een
// dubbele bevestiging: eerst een knop om het paneel open te klappen, dan
// exact intypen van "WIPE ALL COMPANIES" om te bevestigen.
// =====================================================================
function DangerZone({ onDone }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const canSubmit = confirm.trim() === 'WIPE ALL COMPANIES';

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true); setErr(''); setResult(null);
    try {
      const { data } = await api.post('/superadmin/wipe-all-companies', {
        confirm: 'WIPE ALL COMPANIES',
      });
      setResult(data);
      setConfirm('');
      if (onDone) onDone();
    } catch (e) {
      setErr(formatError(e) || 'Kon niet wissen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mt-8" data-testid="danger-zone">
      <div className="rounded-2xl border-2 border-red-200 bg-red-50/50 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center">
              <Trash2 className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <h2 className="text-sm font-black text-red-700 uppercase tracking-widest">Danger Zone</h2>
              <p className="text-[11px] text-red-600/80 font-semibold">Onomkeerbare acties — pas op.</p>
            </div>
          </div>
          {!open && (
            <button onClick={() => setOpen(true)} data-testid="danger-open-btn"
              className="h-9 px-3 rounded-lg bg-white border border-red-200 hover:border-red-400 text-red-700 font-bold text-xs">
              Toon opties
            </button>
          )}
        </div>

        {open && (
          <div className="px-5 pb-5 border-t border-red-200 pt-4">
            <div className="bg-white rounded-xl p-4 border border-red-200">
              <h3 className="font-black text-slate-900 text-sm">Alle bedrijven + data wissen</h3>
              <p className="text-xs text-slate-600 mt-1">
                Verwijdert <b>alle</b> bedrijven, huurders, facturen, betalingen, plans en admins.
                Behoudt: <b>superadmin logins</b> en het <b>&ldquo;Demo Vastgoed N.V.&rdquo;</b> demo-bedrijf.
              </p>
              <div className="mt-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Typ ter bevestiging: <span className="text-red-600 font-mono">WIPE ALL COMPANIES</span>
                </label>
                <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  data-testid="danger-confirm-input"
                  placeholder="WIPE ALL COMPANIES"
                  className="w-full mt-1 h-11 px-3 rounded-lg border-2 border-slate-200 focus:border-red-500 outline-none text-sm font-mono" />
              </div>

              {err && (
                <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-semibold" data-testid="danger-error">
                  {err}
                </div>
              )}
              {result && (
                <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800" data-testid="danger-result">
                  <p className="font-black mb-1">✓ Wipe voltooid</p>
                  <p>Behouden: {result.remaining_companies} bedrijf · {result.remaining_users} users (superadmin + demo).</p>
                  <p className="mt-1 text-[11px] opacity-80">
                    Verwijderd: {Object.entries(result.deleted || {})
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => `${v} ${k}`)
                      .join(', ')}
                  </p>
                </div>
              )}

              <div className="mt-4 flex gap-2 justify-end">
                <button onClick={() => { setOpen(false); setConfirm(''); setErr(''); }}
                  data-testid="danger-cancel-btn"
                  className="h-10 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm">
                  Annuleren
                </button>
                <button onClick={submit} disabled={!canSubmit || loading}
                  data-testid="danger-wipe-btn"
                  className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-bold text-sm inline-flex items-center gap-2">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Definitief wissen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
