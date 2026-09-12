import { useState } from 'react';
import {
  ChevronRight, Mail, PiggyBank, Loader2, MessageCircle,
  Calendar, AlertTriangle, Clock, Check, Receipt, Banknote,
} from 'lucide-react';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../../../lib/api';
import { openWhatsApp } from '../../../../lib/external-link';
import PaidHistorySection from './PaidHistorySection';
import QuickPayModal from './QuickPayModal';

// =====================================================================
// InvoiceDetailPage — 1:1 gestileerd zoals PaymentDetail:
//   • Terug-pil bovenaan
//   • Hoofdcard met huurder-naam links + TOTAAL OPENSTAAND rechts + badges
//   • Sub-card "Overzicht" (DetailRow lijst met aantal maanden etc.)
//   • Sub-card "Openstaande facturen" (klikbare rijen → QuickPay)
//   • Sub-card "Betalingsgeschiedenis"
//   • Sub-card "Acties" (E-mail herinnering + WhatsApp deeplink + Registreer)
// =====================================================================
export default function InvoiceDetailPage({ group, credits, tenants = [], onBack, onReminder, onPaid, onCreditClick: _onCreditClick }) {
  const g = group;
  const overdue = (g.overdue || []).filter((i) => (i.status || '') !== 'paid');
  const current = (g.current || []).filter((i) => (i.status || '') !== 'paid');
  const future = (g.upcoming || []).filter((i) => (i.status || '') !== 'paid');
  const paid = (g.all || []).filter((i) => (i.status || '') === 'paid');
  const sev = g.severity;
  const [quickPayInv, setQuickPayInv] = useState(null);
  const [applyingCredit, setApplyingCredit] = useState(false);

  const primaryOpen = overdue[0] || current[0] || future[0] || null;
  const currency = g.currency || primaryOpen?.currency || 'SRD';
  const availableCredit = Number((credits && credits[currency]) || 0);
  const canApplyCredit = availableCredit > 0 && (overdue.length + current.length) > 0;
  const openCount = overdue.length + current.length;
  const totalOpen = [...overdue, ...current].reduce((s, inv) => {
    const remaining = Number(
      inv.remaining_amount != null
        ? inv.remaining_amount
        : Math.max(0, Number(inv.amount || 0) - Number(inv.paid_amount || 0)),
    );
    return s + remaining;
  }, 0);

  const statusBadge = (() => {
    if (sev === 'critical') return { l: 'Kritiek achterstallig', cls: 'bg-red-100 text-red-700' };
    if (sev === 'late') return { l: 'Achterstallig', cls: 'bg-orange-100 text-orange-700' };
    if ((g.currentCount || 0) > 0) return { l: 'Lopende maand open', cls: 'bg-amber-100 text-amber-700' };
    return { l: 'Op tijd', cls: 'bg-emerald-100 text-emerald-700' };
  })();

  const applyCredit = async () => {
    const target = overdue[0] || current[0];
    if (!target || applyingCredit) return;
    setApplyingCredit(true);
    try {
      const { data } = await api.post(`/invoices/${target.id}/apply-credit`);
      if (onPaid) {
        onPaid({
          receipt_number: 'krediet-verrekening',
          amount: data.applied,
          currency,
          _credit_applied: true,
          _message: `${fmtMoney(data.applied, currency)} tegoed verrekend met ${target.invoice_number}`,
        });
      }
    } catch (e) {
      alert(formatError(e) || 'Kon tegoed niet verrekenen');
    } finally {
      setApplyingCredit(false);
    }
  };

  return (
    <div className="space-y-4 pb-24 sm:pb-6" data-testid={`invoice-detail-page-${g.tenant_id}`}>
      {/* ================= TERUG-PIL ================= */}
      <div className="flex items-center gap-2">
        <button onClick={onBack} data-testid="invoice-detail-back"
          className="flex items-center gap-1.5 text-slate-700 font-bold bg-white hover:bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
          <ChevronRight className="w-4 h-4 rotate-180" /> Terug
        </button>
      </div>

      {/* ================= HOOFDCARD ================= */}
      <div className="bg-white rounded-2xl shadow-sm p-5 border border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-black text-slate-900 truncate">{g.tenant_name || 'Onbekende huurder'}</h1>
            {g.apartment_number && (
              <p className="text-[11px] sm:text-xs text-slate-500 truncate">
                {g.location_name ? `${g.location_name} · ` : ''}Appt. {g.apartment_number}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400">Openstaand</p>
            <p className="text-base sm:text-2xl font-black text-slate-900 whitespace-nowrap">{fmtMoney(totalOpen, currency)}</p>
            <p className="text-[10px] sm:text-[11px] text-slate-500">totaal saldo</p>
          </div>
        </div>
        {/* Badges op eigen regel = volledige kaartbreedte. Ultracompact
            (`text-[9px]`, `px-1.5`, `gap-1`) + verkorte labels zodat alle 3
            ook op een smalle Android-viewport (~320px) op één regel passen. */}
        <div className="flex items-center gap-1 flex-wrap mt-3">
          <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap ${statusBadge.cls}`}>{statusBadge.l}</span>
          {openCount > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap bg-orange-50 text-[#FF5C00]">
              {openCount}× open
            </span>
          )}
          {overdue.length > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap bg-red-50 text-red-700">
              {overdue.length}× laat
            </span>
          )}
        </div>
      </div>

      {/* SUB-CARD "Overzicht" verwijderd op verzoek gebruiker (2026-02):
          de KPI's (achterstand/lopend/toekomstig) zijn al zichtbaar via
          de badges in de hoofdcard, en de facturenlijst hieronder toont
          de details per regel. */}

      {/* ================= SUB-CARD: TEGOED VERREKENEN (indien) ================= */}
      {canApplyCredit && (
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-emerald-100 flex items-center justify-between">
            <h2 className="text-sm font-black text-emerald-900 uppercase tracking-widest">Tegoed beschikbaar</h2>
            <span className="text-[10px] font-bold text-emerald-600">{fmtMoney(availableCredit, currency)}</span>
          </div>
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
              <PiggyBank className="w-4 h-4" />
            </div>
            <p className="text-sm text-slate-700 flex-1">Verreken met de oudste openstaande factuur.</p>
            <button type="button" onClick={applyCredit} disabled={applyingCredit}
              data-testid="apply-credit-btn"
              className="shrink-0 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black rounded-xl disabled:opacity-50 inline-flex items-center gap-1.5">
              {applyingCredit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Verreken
            </button>
          </div>
        </div>
      )}

      {/* ================= SUB-CARD: OPENSTAANDE FACTUREN ================= */}
      {(overdue.length + current.length + future.length) > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden" data-testid="invoice-detail-open-list">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Openstaande facturen</h2>
            <span className="text-[10px] font-bold text-slate-400">{overdue.length + current.length + future.length} factu{(overdue.length + current.length + future.length) === 1 ? 'ur' : 'ren'}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {[...overdue, ...current, ...future].map((inv) => {
              const bucket = overdue.includes(inv) ? 'overdue' : current.includes(inv) ? 'current' : 'future';
              const cfg = bucket === 'overdue'
                ? { chip: 'bg-red-50 text-red-700', iconBg: 'bg-red-50 text-red-600', label: 'Te laat', Icon: AlertTriangle }
                : bucket === 'current'
                  ? { chip: 'bg-orange-50 text-[#FF5C00]', iconBg: 'bg-orange-50 text-[#FF5C00]', label: 'Deze maand', Icon: Calendar }
                  : { chip: 'bg-slate-100 text-slate-600', iconBg: 'bg-slate-100 text-slate-500', label: 'Toekomst', Icon: Clock };
              const monthName = MONTHS_NL[(inv.period_month || 1) - 1];
              const canPay = bucket !== 'future';
              const remaining = Number(
                inv.remaining_amount != null
                  ? inv.remaining_amount
                  : Math.max(0, Number(inv.amount || 0) - Number(inv.paid_amount || 0)),
              );
              const partial = Number(inv.paid_amount || 0) > 0;
              return (
                <button key={inv.id} type="button"
                  onClick={() => canPay && setQuickPayInv(inv)}
                  disabled={!canPay}
                  data-testid={`inv-card-${inv.id}`}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 ${canPay ? 'hover:bg-slate-50 active:bg-slate-100' : 'opacity-70 cursor-default'} transition`}>
                  <div className={`w-9 h-9 rounded-xl ${cfg.iconBg} flex items-center justify-center shrink-0`}>
                    <cfg.Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 text-sm truncate">
                      {monthName} {inv.period_year}
                      <span className={`ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${cfg.chip}`}>
                        {cfg.label}
                      </span>
                      {partial && (
                        <span className="ml-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          partieel
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono truncate">{inv.invoice_number}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-slate-900 text-sm whitespace-nowrap">{fmtMoney(remaining, inv.currency)}</p>
                    <p className="text-[10px] text-slate-400">{canPay ? 'nog open' : 'toekomst'}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= SUB-CARD: ALLES OP TIJD ================= */}
      {openCount === 0 && future.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 overflow-hidden">
          <div className="p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center mx-auto mb-3">
              <Check className="w-7 h-7 text-white" />
            </div>
            <p className="text-lg font-black text-emerald-900">Alles op tijd</p>
            <p className="text-sm text-emerald-700 mt-1">Geen openstaande facturen — deze huurder loopt netjes bij.</p>
          </div>
        </div>
      )}

      {/* ================= SUB-CARD: BETALINGSGESCHIEDENIS ================= */}
      {paid.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Betalingsgeschiedenis</h2>
            <span className="text-[10px] font-bold text-slate-400">{paid.length} betaald</span>
          </div>
          <div className="p-4">
            <PaidHistorySection paidInvoices={paid} currency={currency} testidPrefix={`detail-paid-${g.tenant_id}`} />
          </div>
        </div>
      )}

      {/* ================= SUB-CARD: ACTIES ================= */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Acties</h2>
        </div>
        <div className="p-4 space-y-3">
          {/* Actie-knoppen: E-mail herinnering (via Twilio/SMTP) + directe
              WhatsApp-deeplink naar huurder (opent gewoon de chat).
              WhatsApp/SMS via Twilio zijn bewust verwijderd — de deeplink
              werkt zonder API-configuratie. */}
          {openCount > 0 && (() => {
            const tenant = tenants.find((t) => t.id === g.tenant_id) || {};
            const phoneDigits = String(tenant.phone || '').replace(/\D/g, '');
            const hasPhone = phoneDigits.length >= 7;
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" onClick={() => onReminder(g, 'email')}
                  data-testid={`reminder-btn-email-${g.tenant_id}`}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-white border-2 border-blue-300 hover:bg-blue-50 text-blue-700 font-bold rounded-xl text-xs sm:text-sm transition">
                  <Mail className="w-4 h-4" /> E-mail herinnering
                </button>
                <button type="button"
                  disabled={!hasPhone}
                  onClick={() => {
                    if (!hasPhone) return;
                    const msg = `Hallo ${tenant.name || ''}, dit is een herinnering vanuit ${g.company_name || ''} over uw openstaande huur.`;
                    openWhatsApp(phoneDigits, msg.trim());
                  }}
                  data-testid={`open-whatsapp-${g.tenant_id}`}
                  title={hasPhone ? `Open WhatsApp-chat met ${tenant.name}` : 'Huurder heeft geen telefoonnummer'}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-white border-2 border-emerald-300 hover:bg-emerald-50 text-emerald-700 font-bold rounded-xl text-xs sm:text-sm transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <MessageCircle className="w-4 h-4" /> Open WhatsApp met huurder
                </button>
              </div>
            );
          })()}
          {/* Primary CTA */}
          {primaryOpen && (
            <button type="button" onClick={() => setQuickPayInv(primaryOpen)}
              data-testid="quickpay-primary-btn"
              className="w-full py-3.5 rounded-xl text-white font-black inline-flex items-center justify-center gap-2 shadow-[0_10px_20px_-8px_rgba(255,92,0,0.45)] active:scale-[0.98] transition-transform"
              style={{ background: 'linear-gradient(135deg, #FF8A3D 0%, #FF5C00 100%)' }}>
              <Banknote className="w-5 h-5" /> Registreer betaling
            </button>
          )}
          {!primaryOpen && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Receipt className="w-4 h-4" />
              Geen open facturen om te registreren.
            </div>
          )}
        </div>
      </div>

      {/* QuickPay modal */}
      {quickPayInv && (() => {
        const t = tenants.find((x) => x.id === g.tenant_id) || {};
        return (
        <QuickPayModal
          invoice={quickPayInv}
          tenantName={g.tenant_name}
          tenantPhone={t.phone || ''}
          otherOpenInvoices={[...overdue, ...current].filter((i) => i.id !== quickPayInv.id)}
          onClose={() => setQuickPayInv(null)}
          onSuccess={(payment) => {
            setQuickPayInv(null);
            if (onPaid) onPaid(payment);
          }}
        />
        );
      })()}
    </div>
  );
}

// DetailRow — identiek aan PaymentDetail voor consistente look & feel.
function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-semibold text-right">{value}</span>
    </div>
  );
}
