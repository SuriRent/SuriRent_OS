import { ArrowLeft, Search, Loader2, CalendarPlus, FilePlus2, FileSignature, Banknote, MessageCircle, ChevronRight, Check, AlertCircle, Calendar, User, X } from 'lucide-react';
import villaM from '../ui-villa-m.png';
import { fmtAmount } from '../pages/vastgoed/admin/invoices/helpers';
import { CreditBadge } from './KioskInvoiceExtras';
import { TenantPhoto } from './KioskFx';

const NAVY = 'text-[#1B2A5C]';
const money = (v, c) => `${c || 'SRD'} ${fmtAmount(v, c)}`;
const openPay = (tenantId) => window.dispatchEvent(new CustomEvent('kiosk-open-tenant', { detail: { tenant_id: tenantId } }));
const VILLA_MASK = 'linear-gradient(to right, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 30%)';

export function uiTone(g) {
  if (g.overdueCount >= 1) return { pill: 'bg-red-500 text-white', text: g.overdueCount === 1 ? '1 maand achter' : `${g.overdueCount} maanden achter`, paid: false };
  if (g.currentCount > 0) return { pill: 'bg-amber-500 text-white', text: 'Deze maand open', paid: false };
  return { pill: 'bg-emerald-600 text-white', text: 'Alles betaald', paid: true };
}

export function UiBar({ title, onBack, testId }) {
  return (
    <div className="flex items-center gap-3 px-3 pb-2" style={{ paddingTop: 'max(var(--kiosk-sat), 14px)' }}>
      {onBack && (
        <button type="button" onClick={onBack} data-testid={testId} aria-label="Terug"
          className="w-11 h-11 rounded-2xl bg-white shadow-[0_6px_14px_-8px_rgba(15,23,42,0.45)] flex items-center justify-center text-[#FF5C00]">
          <ArrowLeft className="w-5 h-5" strokeWidth={2.6} />
        </button>
      )}
      <span className={`text-xl font-extrabold ${NAVY} truncate`}>{title}</span>
    </div>
  );
}

export function UiHero({ icon, title, sub, children }) {
  return (
    <div className="relative mx-2 rounded-3xl overflow-hidden bg-gradient-to-r from-[#FF6A00] via-[#FF8A2B] to-[#FFC08A] px-4 py-5 text-white shadow-[0_14px_28px_-16px_rgba(255,106,0,0.8)]">
      <img src={villaM} alt="" className="absolute -right-4 bottom-0 h-[90%] w-auto max-w-none pointer-events-none"
        style={{ WebkitMaskImage: VILLA_MASK, maskImage: VILLA_MASK, WebkitMaskComposite: 'source-in', maskComposite: 'intersect' }} />
      <div className="relative flex items-center gap-3 min-w-0">
        <span className="shrink-0 w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-[#FF6A00] shadow-md">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold leading-tight truncate">{title}</h2>
          {sub && <p className="text-[13px] text-white/90 truncate">{sub}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function UiStat({ Icon, tone, label, value, bar, barTone, testId }) {
  return (
    <div className="rounded-2xl bg-white px-2.5 py-2.5 shadow-[0_8px_22px_-14px_rgba(15,23,42,0.35)] min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${tone}`}><Icon className="w-3.5 h-3.5" strokeWidth={2.6} /></span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-600 truncate leading-tight">{label}</p>
          <p className={`text-[12.5px] font-extrabold ${NAVY} leading-tight whitespace-nowrap`} data-testid={testId}>{value}</p>
        </div>
      </div>
      {bar !== undefined && <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className={`h-full rounded-full ${barTone}`} style={{ width: bar }} /></div>}
    </div>
  );
}

function pct(n, total) { return `${total ? Math.min(100, Math.round((n / total) * 100)) : 0}%`; }

export function UiInvoicesList({
  groups, s, month, q, setQ, tab, setTab, tabs, severity, setSeverity, data, error, credits, creditOf,
  onOpen, onRemind, generate, busy, onNew, onBack,
}) {
  return (
    <div className="pb-8" data-testid="kiosk-ui-invoices">
      <UiBar title="Facturen" onBack={onBack} testId="kiosk-admin-page-back" />
      <UiHero icon={<FileSignature className="w-7 h-7" strokeWidth={2} />} title="Facturen Overzicht" sub={`Totaal: ${groups.length} huurders`} />
      <div className="grid grid-cols-[1fr_1fr_1.45fr] gap-1.5 -mt-1 px-2 mt-2" data-testid="kiosk-inv-mobile-stats">
        <UiStat Icon={AlertCircle} tone="bg-red-500 text-white" label="Achterstand" value={`${s.openCount || 0} / ${s.allCount || 0}`}
          bar={pct(s.openCount || 0, s.allCount || 0)} barTone="bg-red-500" testId="kiosk-inv-stat-late" />
        <UiStat Icon={Check} tone="bg-emerald-500 text-white" label="Betaald" value={`${s.paidCount || 0} / ${s.allCount || 0}`}
          bar={pct(s.paidCount || 0, s.allCount || 0)} barTone="bg-emerald-500" />
        <UiStat Icon={Calendar} tone="bg-orange-100 text-[#FF5C00]" label={`Openstaand`} value={money(s.totalOpenAmount || 0, s.currency)} testId="kiosk-inv-stat-open" />
      </div>
      <div className="mt-3 px-2 flex gap-2">
        <button type="button" onClick={generate} disabled={busy} data-testid="kiosk-inv-generate-mobile"
          className="flex-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-white shadow-sm text-xs font-extrabold text-[#FF5C00] disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Genereer {month}
        </button>
        <button type="button" onClick={onNew} data-testid="kiosk-inv-new-mobile"
          className="flex-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-[#FF5C00] text-xs font-black text-white shadow-[0_10px_22px_-10px_rgba(255,92,0,0.8)]">
          <FilePlus2 className="h-4 w-4" /> Nieuwe factuur
        </button>
      </div>
      <div className="mt-3 px-2">
        <label className="flex items-center gap-3 h-12 rounded-2xl bg-white px-4 shadow-[0_8px_22px_-14px_rgba(15,23,42,0.35)]">
          <Search className="w-5 h-5 text-[#1B2A5C]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek huurder of appartement…" data-testid="kiosk-inv-search-mobile"
            className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Wissen"><X className="w-4 h-4 text-slate-400" /></button>}
        </label>
      </div>
      <div className="mt-2 px-2 flex gap-1.5 overflow-x-auto" data-testid="kiosk-inv-mobile-filter-bar">
        {tabs.map((f) => (
          <button key={f.v} type="button" onClick={() => setTab(f.v)} data-testid={`kiosk-inv-mobile-filter-${f.v}`}
            className={`flex-1 min-w-max px-3 h-10 rounded-2xl text-xs font-black transition-colors ${tab === f.v ? 'bg-[#FF5C00] text-white shadow' : 'bg-white text-[#1B2A5C] shadow-sm'}`}>
            {f.label} ({s[f.key] ?? 0})
          </button>
        ))}
      </div>
      <div className="mt-3 px-2 space-y-3">
        {error && <p role="alert" className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        {!data && !error && <Loader2 className="mx-auto my-8 h-7 w-7 animate-spin text-[#FF5C00]" />}
        {groups.map((g) => {
          const t = uiTone(g);
          const credit = creditOf(credits, g.tenant_id, g.currency);
          return (
            <div key={g.tenant_id} data-testid={`kiosk-inv-tile-${g.tenant_id}`}
              className="rounded-3xl bg-white p-3 shadow-[0_10px_26px_-16px_rgba(15,23,42,0.4)]">
              <div role="button" tabIndex={0} onClick={() => onOpen(g)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(g); }}
                className="flex items-center gap-3 cursor-pointer" data-testid={`kiosk-inv-open-${g.tenant_id}`}>
                <TenantPhoto tenantId={g.tenant_id} name={g.tenant_name} size={52} />
                <div className="min-w-0 flex-1">
                  <p className={`text-[17px] font-extrabold ${NAVY} truncate leading-tight`}>{g.apartment_number || 'Geen appartement'}</p>
                  <p className={`flex items-center gap-1 text-[14px] ${NAVY} truncate`}><User className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{g.tenant_name || g.location_name || ' '}</span></p>
                  <CreditBadge amount={credit} currency={g.currency} testId={`kiosk-inv-credit-${g.tenant_id}`} />
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <span className={`rounded-full px-3 py-1.5 text-[12px] font-extrabold whitespace-nowrap ${t.pill}`}>
                    {t.paid ? '✓ Betaald' : money(g.totalDue, g.currency)}
                  </span>
                  {!t.paid && <span className="text-[10px] font-bold text-slate-500">{t.text}</span>}
                </div>
                <span className="shrink-0 w-9 h-9 rounded-full bg-[#F1F3F9] flex items-center justify-center"><ChevronRight className={`w-4 h-4 ${NAVY}`} /></span>
              </div>
              {g.dueCount > 0 && (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => openPay(g.tenant_id)} data-testid={`kiosk-inv-pay-${g.tenant_id}`}
                    className="flex-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl bg-orange-50 text-xs font-extrabold text-[#FF5C00]">
                    <Banknote className="h-4 w-4" /> Betalen
                  </button>
                  <button type="button" onClick={() => onRemind(g)} data-testid={`kiosk-inv-remind-${g.tenant_id}`}
                    className="flex-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl bg-emerald-50 text-xs font-extrabold text-emerald-700">
                    <MessageCircle className="h-4 w-4" /> Herinnering
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {data && !error && groups.length === 0 && (
          <p className="rounded-2xl bg-white py-12 text-center text-sm font-semibold text-slate-500" data-testid="kiosk-inv-empty">Geen facturen gevonden.</p>
        )}
      </div>
    </div>
  );
}

export function UiDetailHead({ g, tenant, credit, onBack, onNewInvoice, onRemind }) {
  const t = uiTone(g);
  return (
    <div className="-mx-1">
      <UiBar title="Factuur details" onBack={onBack} testId="kiosk-inv-detail-back" />
      <div className="relative mx-2 rounded-3xl overflow-hidden bg-gradient-to-r from-[#FF6A00] via-[#FF8A2B] to-[#FFC08A] px-4 py-5 text-white shadow-[0_14px_28px_-16px_rgba(255,106,0,0.8)]">
        <img src={villaM} alt="" className="absolute -right-4 bottom-0 h-[90%] w-auto max-w-none pointer-events-none"
          style={{ WebkitMaskImage: VILLA_MASK, maskImage: VILLA_MASK, WebkitMaskComposite: 'source-in', maskComposite: 'intersect' }} />
        <div className="relative flex items-center gap-3 min-w-0">
          <span className="shrink-0 rounded-full ring-4 ring-white/80"><TenantPhoto tenantId={g.tenant_id} name={g.tenant_name} size={60} /></span>
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold leading-tight truncate" data-testid="kiosk-inv-detail-apartment">{tenant?.name || g.tenant_name || 'Onbekende huurder'}</h2>
            <p className="text-[13px] text-white/90 truncate" data-testid="kiosk-inv-detail-name">
              {g.apartment_number || 'Geen appartement'}{g.location_name ? ` · ${g.location_name}` : ''}
            </p>
            <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${t.paid ? 'bg-emerald-600' : 'bg-red-500'}`}>{t.text}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 px-2">
        <UiStat Icon={AlertCircle} tone="bg-red-500 text-white" label="Openstaand" value={money(g.totalDue, g.currency)} testId="kiosk-inv-detail-total" />
        <UiStat Icon={FileSignature} tone="bg-orange-100 text-[#FF5C00]" label="Open facturen" value={g.open.length} />
        <UiStat Icon={Check} tone="bg-emerald-500 text-white" label="Tegoed" value={money(credit, g.currency)} />
      </div>
      <div className="mt-2 flex gap-2 px-2">
        <button type="button" onClick={onNewInvoice} data-testid="kiosk-inv-detail-new"
          className="flex-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-white shadow-sm text-xs font-extrabold text-[#FF5C00]"><FilePlus2 className="h-4 w-4" /> Factuur</button>
        {g.dueCount > 0 && (
          <>
            <button type="button" onClick={() => openPay(g.tenant_id)} data-testid="kiosk-inv-detail-pay"
              className="flex-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-[#FF5C00] text-xs font-black text-white shadow-[0_10px_22px_-10px_rgba(255,92,0,0.8)]"><Banknote className="h-4 w-4" /> Betalen</button>
            <button type="button" onClick={() => onRemind(g)} data-testid="kiosk-inv-detail-remind"
              className="flex-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 text-xs font-black text-white"><MessageCircle className="h-4 w-4" /> Herinnering</button>
          </>
        )}
      </div>
    </div>
  );
}
