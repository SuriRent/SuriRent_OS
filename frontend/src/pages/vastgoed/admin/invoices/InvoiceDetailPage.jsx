import { useState } from 'react';
import { ChevronLeft, Mail, PiggyBank, Loader2, MessageCircle, Phone, Calendar, AlertTriangle, Clock, Check, ChevronRight, Receipt, Banknote } from 'lucide-react';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../../../lib/api';
import PaidHistorySection from './PaidHistorySection';
import QuickPayModal from './QuickPayModal';

// =====================================================================
// InvoiceDetailPage — Premium zakelijk design
//  - Terug pill knop
//  - Huurder card met VL avatar (oranje gradient) + status badge
//  - Totaal openstaand card met donkere navy achtergrond
//  - Openstaande facturen cards
//  - Herinnering versturen (WhatsApp/E-mail/SMS) met gekleurde icon-cards
//  - Sticky "Registreer betaling" gradient CTA onderaan
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
  const openTotal = overdue.length + current.length;

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

  const initials = (g.tenant_name || 'HR').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();

  const statusPill = sev === 'critical'
    ? { bg: 'bg-red-50', text: 'text-red-700', label: 'Kritiek achterstallig', Icon: AlertTriangle }
    : sev === 'late'
      ? { bg: 'bg-orange-50', text: 'text-[#FF5C00]', label: 'Achterstallig', Icon: Clock }
      : g.currentCount > 0
        ? { bg: 'bg-orange-50', text: 'text-[#FF5C00]', label: 'Lopende maand open', Icon: Calendar }
        : { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Op tijd', Icon: Check };

  return (
    <div className="space-y-4 pb-40 md:pb-6" data-testid={`invoice-detail-page-${g.tenant_id}`}>
      {/* =============== Terug knop =============== */}
      <div>
        <button onClick={onBack}
          data-testid="invoice-detail-back"
          className="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-900 font-bold text-sm bg-white hover:bg-slate-50 border border-slate-200 rounded-full pl-2.5 pr-4 py-2 shadow-sm">
          <ChevronLeft className="w-4 h-4" /> Terug
        </button>
      </div>

      {/* =============== Huurder card — soft orange bg + status =============== */}
      <div className="bg-orange-50/60 border border-orange-100 rounded-3xl p-3 flex items-center gap-3">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-white text-lg shrink-0 shadow-lg"
          style={{ background: 'linear-gradient(135deg, #FFB770 0%, #FF6A1A 100%)' }}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black text-slate-900 truncate leading-tight">{g.tenant_name}</h1>
          {g.apartment_number && (
            <p className="text-xs text-slate-500 truncate mt-0.5">
              {g.location_name ? `${g.location_name} · ` : ''}{g.apartment_number}
            </p>
          )}
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg ${statusPill.bg} ${statusPill.text} shrink-0`}>
          <statusPill.Icon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{statusPill.label}</span>
          <span className="sm:hidden">{statusPill.label.split(' ')[0]}</span>
        </span>
      </div>

      {/* =============== Totaal openstaand — dark navy card =============== */}
      <div className="rounded-3xl p-5 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
        <div className="absolute -right-10 -bottom-10 w-40 h-40 rounded-full bg-white/5" />
        <div className="absolute right-5 top-5">
          <span className="inline-block text-[10px] font-black uppercase tracking-wider text-white bg-white/15 backdrop-blur-sm rounded-full px-2.5 py-1">
            {g.dueCount > 0 ? `${g.dueCount} maand${g.dueCount === 1 ? '' : 'en'}` : 'Op tijd'}
          </span>
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Totaal openstaand</p>
        <p className="text-4xl font-black tracking-tight text-white mt-1.5">
          {fmtMoney(g.totalDue, currency)}
        </p>
        <div className="absolute right-5 bottom-5">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-white/10 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-white" />
          </div>
        </div>
      </div>

      {/* =============== Krediet banner =============== */}
      {canApplyCredit && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
            <PiggyBank className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-emerald-900">Tegoed beschikbaar</p>
            <p className="text-xs text-emerald-700">Verreken {fmtMoney(availableCredit, currency)} met oudste openstaande factuur</p>
          </div>
          <button type="button" onClick={applyCredit} disabled={applyingCredit}
            data-testid="apply-credit-btn"
            className="shrink-0 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black rounded-xl disabled:opacity-50 inline-flex items-center gap-1.5">
            {applyingCredit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Verreken
          </button>
        </div>
      )}

      {/* =============== Openstaande facturen =============== */}
      {(overdue.length + current.length + future.length) > 0 && (
        <div>
          <h2 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2.5 px-1">Openstaande facturen</h2>
          <div className="space-y-2.5">
            {[...overdue, ...current, ...future].map((inv) => {
              const bucket = overdue.includes(inv) ? 'overdue' : current.includes(inv) ? 'current' : 'future';
              const bucketCfg = bucket === 'overdue'
                ? { chip: 'bg-red-50 text-red-700', iconBg: 'bg-red-50 text-red-600', label: 'Te laat', Icon: AlertTriangle }
                : bucket === 'current'
                  ? { chip: 'bg-orange-50 text-[#FF5C00]', iconBg: 'bg-orange-50 text-[#FF5C00]', label: 'Deze maand', Icon: Calendar }
                  : { chip: 'bg-slate-100 text-slate-600', iconBg: 'bg-slate-100 text-slate-500', label: 'Toekomst', Icon: Clock };
              const monthName = MONTHS_NL[inv.period_month - 1];
              const canPay = bucket !== 'future';
              const remaining = inv.amount - (inv.paid_amount || 0);
              return (
                <button key={inv.id} type="button"
                  onClick={() => canPay && setQuickPayInv(inv)}
                  disabled={!canPay}
                  data-testid={`inv-card-${inv.id}`}
                  className={`w-full text-left bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3 ${canPay ? 'active:bg-slate-50 hover:shadow-md' : 'opacity-70 cursor-default'} transition`}>
                  <div className={`w-12 h-12 rounded-2xl ${bucketCfg.iconBg} flex items-center justify-center shrink-0`}>
                    <bucketCfg.Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 truncate">{monthName} {inv.period_year}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${bucketCfg.chip}`}>
                        {bucketCfg.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate font-mono">{inv.invoice_number}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-black text-slate-900 whitespace-nowrap">{fmtMoney(remaining, inv.currency)}</p>
                    {canPay && (
                      <p className="text-[11px] font-bold text-[#FF5C00] mt-0.5">Registreer →</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* =============== Alles op tijd =============== */}
      {openTotal === 0 && future.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center mx-auto mb-3">
            <Check className="w-7 h-7 text-white" />
          </div>
          <p className="text-lg font-black text-emerald-900">Alles op tijd</p>
          <p className="text-sm text-emerald-700 mt-1">Geen openstaande facturen — deze huurder loopt netjes bij.</p>
        </div>
      )}

      {/* =============== Betalingsgeschiedenis =============== */}
      <div>
        <PaidHistorySection paidInvoices={paid} currency={currency} testidPrefix={`detail-paid-${g.tenant_id}`} />
      </div>

      {/* =============== Herinnering versturen — 3 kleur-cards =============== */}
      {openTotal > 0 && (
        <div>
          <h2 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2.5 px-1">Herinnering versturen</h2>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { id: 'whatsapp', label: 'WhatsApp', sub: 'Stuur via WhatsApp', iconBg: 'bg-emerald-100 text-emerald-600', Icon: MessageCircle, hover: 'hover:border-emerald-200' },
              { id: 'email',    label: 'E-mail',   sub: 'Stuur via e-mail',   iconBg: 'bg-blue-100 text-blue-600',        Icon: Mail,           hover: 'hover:border-blue-200' },
              { id: 'sms',      label: 'SMS',      sub: 'Stuur via SMS',      iconBg: 'bg-purple-100 text-purple-600',    Icon: Phone,          hover: 'hover:border-purple-200' },
            ].map((c) => (
              <button key={c.id} type="button" onClick={() => onReminder(g, c.id)}
                data-testid={`reminder-btn-${c.id}-${g.tenant_id}`}
                className={`p-3 bg-white border border-slate-100 rounded-2xl shadow-sm transition active:scale-95 text-left ${c.hover}`}>
                <div className="flex items-start justify-between mb-2.5">
                  <div className={`w-11 h-11 rounded-2xl ${c.iconBg} flex items-center justify-center`}>
                    <c.Icon className="w-5 h-5" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-sm font-black text-slate-900">{c.label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{c.sub}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* =============== STICKY MOBILE CTA — gradient met subtitle =============== */}
      {primaryOpen && (
        <div className="md:hidden fixed left-0 right-0 z-40 px-4 pt-3 bg-gradient-to-t from-white via-white to-white/60"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 60px)', paddingBottom: '12px' }}>
          <button type="button" onClick={() => setQuickPayInv(primaryOpen)}
            data-testid="quickpay-primary-btn"
            className="w-full py-4 rounded-3xl text-white font-black inline-flex flex-col items-center justify-center gap-0.5 shadow-[0_14px_28px_-10px_rgba(255,92,0,0.55)] active:scale-[0.98] transition-transform"
            style={{ background: 'linear-gradient(135deg, #FF8A3D 0%, #FF5C00 100%)' }}>
            <span className="inline-flex items-center gap-2 text-base">
              <Banknote className="w-5 h-5" /> Registreer betaling
            </span>
            <span className="text-[11px] font-medium text-white/85">Ontvang een betaling voor deze factuur</span>
          </button>
        </div>
      )}

      {/* Desktop CTA */}
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
