import { useState } from 'react';
import { ChevronLeft, Mail, Banknote, PiggyBank, Loader2, MessageCircle, Phone, Calendar, AlertTriangle, Clock, Check } from 'lucide-react';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../../../lib/api';
import PaidHistorySection from './PaidHistorySection';
import QuickPayModal from './QuickPayModal';

// =====================================================================
// InvoiceDetailPage — Detail-pagina voor 1 huurder. Split in twee layouts:
//  - Mobile (< md): full-bleed hero met sticky action-CTA onderaan
//  - Desktop (md+): traditional card layout
// =====================================================================
export default function InvoiceDetailPage({ group, credits, onBack, onReminder, onPaid, onCreditClick }) {
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

  // Kleur-schema per severity — heldere sfeer + duidelijk accent
  const heroBg = sev === 'critical'
    ? 'bg-gradient-to-br from-red-500 to-red-600'
    : sev === 'late'
      ? 'bg-gradient-to-br from-orange-500 to-[#FF5C00]'
      : g.currentCount > 0
        ? 'bg-gradient-to-br from-amber-400 to-amber-500'
        : 'bg-gradient-to-br from-emerald-500 to-emerald-600';

  const badgeLabel = sev === 'critical' ? 'Kritiek achterstallig'
    : sev === 'late' ? 'Achterstallig'
    : g.currentCount > 0 ? 'Lopende maand open'
    : 'Op tijd';

  const initials = (g.tenant_name || 'HR').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  const openTotal = overdue.length + current.length;

  return (
    <div className="space-y-3 md:space-y-4 -mx-4 md:mx-0 pb-32 md:pb-6" data-testid={`invoice-detail-page-${g.tenant_id}`}>
      {/* =============== HERO — kleur gebonden aan severity =============== */}
      <div className={`${heroBg} text-white md:rounded-3xl px-5 pt-4 pb-6 md:pt-5 md:pb-7 relative overflow-hidden`}>
        {/* Achtergrond-decoratie */}
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-16 -left-4 w-40 h-40 rounded-full bg-white/5" />

        {/* Top row: terug + tenant naam */}
        <div className="relative flex items-center justify-between gap-2 mb-4">
          <button onClick={onBack}
            data-testid="invoice-detail-back"
            className="inline-flex items-center gap-1 text-white/90 hover:text-white font-bold text-sm bg-white/15 hover:bg-white/25 rounded-full pl-2 pr-3 py-1.5 backdrop-blur-sm">
            <ChevronLeft className="w-4 h-4" /> Terug
          </button>
          {availableCredit > 0 && (
            <button type="button" onClick={onCreditClick}
              data-testid={`detail-credit-${g.tenant_id}`}
              className="inline-flex items-center gap-1.5 text-white text-[11px] font-black uppercase tracking-wider bg-white/20 hover:bg-white/30 rounded-full px-3 py-1.5 backdrop-blur-sm">
              <PiggyBank className="w-3.5 h-3.5" />
              {fmtMoney(availableCredit, currency)} tegoed
            </button>
          )}
        </div>

        {/* Avatar + naam */}
        <div className="relative flex items-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-white/25 backdrop-blur-sm flex items-center justify-center font-black text-lg text-white shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-black leading-tight truncate">{g.tenant_name}</h1>
            {g.apartment_number && (
              <p className="text-white/80 text-sm font-semibold truncate">
                {g.location_name ? `${g.location_name} · ` : ''}Appt. {g.apartment_number}
              </p>
            )}
          </div>
        </div>

        {/* Bedrag + label */}
        <div className="relative">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">Totaal openstaand</p>
          <p className="text-4xl md:text-5xl font-black leading-none mt-1">{fmtMoney(g.totalDue, currency)}</p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider bg-white/20 backdrop-blur-sm rounded-full px-2.5 py-1">
              {sev === 'critical' ? <AlertTriangle className="w-3 h-3" />
                : sev === 'late' ? <Clock className="w-3 h-3" />
                : g.currentCount > 0 ? <Calendar className="w-3 h-3" />
                : <Check className="w-3 h-3" />}
              {badgeLabel}
            </span>
            {g.dueCount > 0 && (
              <span className="text-[11px] font-bold uppercase tracking-wider bg-white/15 rounded-full px-2.5 py-1">
                {g.dueCount} open maand{g.dueCount === 1 ? '' : 'en'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* =============== KREDIET VERREKENEN — banner =============== */}
      {canApplyCredit && (
        <div className="mx-4 md:mx-0 bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
            <PiggyBank className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-emerald-900">Tegoed beschikbaar</p>
            <p className="text-xs text-emerald-700">Verreken {fmtMoney(availableCredit, currency)} met de oudste openstaande factuur</p>
          </div>
          <button type="button" onClick={applyCredit} disabled={applyingCredit}
            data-testid="apply-credit-btn"
            className="shrink-0 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black rounded-xl disabled:opacity-50 inline-flex items-center gap-1.5">
            {applyingCredit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Verreken
          </button>
        </div>
      )}

      {/* =============== OPEN FACTUREN — per-maand cards =============== */}
      {(overdue.length + current.length + future.length) > 0 && (
        <div className="mx-4 md:mx-0">
          <h2 className="text-[11px] font-black text-slate-500 uppercase tracking-widest px-1 mb-2">Openstaande facturen</h2>
          <div className="space-y-2">
            {[...overdue, ...current, ...future].map((inv) => {
              const bucket = overdue.includes(inv) ? 'overdue' : current.includes(inv) ? 'current' : 'future';
              const bucketCfg = bucket === 'overdue'
                ? { dot: 'bg-red-500', label: 'Te laat', chip: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle }
                : bucket === 'current'
                  ? { dot: 'bg-amber-500', label: 'Deze maand', chip: 'bg-amber-50 text-amber-700 border-amber-200', icon: Calendar }
                  : { dot: 'bg-slate-300', label: 'Toekomst', chip: 'bg-slate-100 text-slate-600 border-slate-200', icon: Clock };
              const monthName = MONTHS_NL[inv.period_month - 1];
              const canPay = bucket !== 'future';
              const remaining = inv.amount - (inv.paid_amount || 0);
              const Icon = bucketCfg.icon;
              return (
                <button key={inv.id} type="button"
                  onClick={() => canPay && setQuickPayInv(inv)}
                  disabled={!canPay}
                  data-testid={`inv-card-${inv.id}`}
                  className={`w-full text-left bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3 ${canPay ? 'active:bg-slate-50 hover:shadow-md' : 'opacity-70 cursor-default'} transition`}>
                  <div className={`w-10 h-10 rounded-xl ${bucketCfg.chip} border flex items-center justify-center shrink-0`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-black text-slate-900 truncate">{monthName} {inv.period_year}</p>
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${bucketCfg.chip} border`}>
                        {bucketCfg.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate font-mono">{inv.invoice_number}</p>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1">
                    <p className="text-base font-black text-slate-900 whitespace-nowrap">{fmtMoney(remaining, inv.currency)}</p>
                    {canPay && (
                      <div className="inline-flex items-center gap-1 text-[10px] font-bold text-[#FF5C00]">
                        <Banknote className="w-3 h-3" /> Registreer
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* =============== ALLES OP TIJD — success state =============== */}
      {openTotal === 0 && future.length === 0 && (
        <div className="mx-4 md:mx-0 bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center mx-auto mb-3">
            <Check className="w-7 h-7 text-white" />
          </div>
          <p className="text-lg font-black text-emerald-900">Alles op tijd</p>
          <p className="text-sm text-emerald-700 mt-1">Geen openstaande facturen — deze huurder loopt netjes bij.</p>
        </div>
      )}

      {/* =============== BETALINGSGESCHIEDENIS =============== */}
      <div className="mx-4 md:mx-0">
        <PaidHistorySection paidInvoices={paid} currency={currency} testidPrefix={`detail-paid-${g.tenant_id}`} />
      </div>

      {/* =============== CONTACT / HERINNERING — mobiel als knoppen-strip =============== */}
      {openTotal > 0 && (
        <div className="mx-4 md:mx-0">
          <h2 className="text-[11px] font-black text-slate-500 uppercase tracking-widest px-1 mb-2">Herinnering versturen</h2>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => onReminder(g, 'whatsapp')}
              data-testid={`reminder-btn-whatsapp-${g.tenant_id}`}
              className="flex flex-col items-center gap-1.5 p-3 bg-white border border-slate-100 hover:bg-emerald-50 hover:border-emerald-300 rounded-2xl transition active:scale-95">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <MessageCircle className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-slate-700">WhatsApp</span>
            </button>
            <button type="button" onClick={() => onReminder(g, 'email')}
              data-testid={`reminder-btn-email-${g.tenant_id}`}
              className="flex flex-col items-center gap-1.5 p-3 bg-white border border-slate-100 hover:bg-blue-50 hover:border-blue-300 rounded-2xl transition active:scale-95">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                <Mail className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-slate-700">E-mail</span>
            </button>
            <button type="button" onClick={() => onReminder(g, 'sms')}
              data-testid={`reminder-btn-sms-${g.tenant_id}`}
              className="flex flex-col items-center gap-1.5 p-3 bg-white border border-slate-100 hover:bg-slate-50 hover:border-slate-300 rounded-2xl transition active:scale-95">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                <Phone className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-slate-700">SMS</span>
            </button>
          </div>
        </div>
      )}

      {/* =============== STICKY MOBILE CTA — Registreer betaling =============== */}
      {primaryOpen && (
        <div className="md:hidden fixed left-0 right-0 bottom-14 z-30 px-4 pb-3 pt-2 bg-gradient-to-t from-white via-white/95 to-white/0 pointer-events-none">
          <button type="button" onClick={() => setQuickPayInv(primaryOpen)}
            data-testid="quickpay-primary-btn"
            className="pointer-events-auto w-full h-14 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-black inline-flex items-center justify-center gap-2 shadow-[0_14px_28px_-10px_rgba(255,92,0,0.55)] active:scale-[0.98] transition-transform">
            <Banknote className="w-5 h-5" /> Registreer betaling
          </button>
        </div>
      )}

      {/* Desktop CTA — bovenaan open-facturen kaart */}
      {primaryOpen && (
        <div className="hidden md:block sticky top-4 z-10 pointer-events-none">
          <button type="button" onClick={() => setQuickPayInv(primaryOpen)}
            data-testid="quickpay-primary-btn-desktop"
            className="pointer-events-auto float-right px-5 py-3 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-black text-sm inline-flex items-center gap-2 shadow-lg">
            <Banknote className="w-4 h-4" /> Registreer betaling
          </button>
        </div>
      )}

      {/* QuickPay modal */}
      {quickPayInv && (
        <QuickPayModal
          invoice={quickPayInv}
          tenantName={g.tenant_name}
          otherOpenInvoices={[...overdue, ...current].filter((i) => i.id !== quickPayInv.id)}
          onClose={() => setQuickPayInv(null)}
          onSuccess={(payment) => {
            setQuickPayInv(null);
            if (onPaid) onPaid(payment);
          }}
        />
      )}
    </div>
  );
}
