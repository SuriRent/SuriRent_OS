import { useState, useEffect, useCallback, useMemo } from 'react';
import { FxStats, FxSearch, FxRow, FxEmpty, TenantPhoto } from '../../../components/KioskFx';
import { hostConfirm } from '../../../components/EmbedConfirm';
import { useDeepLink } from '../../../lib/deep-link';
import { closeApprovalNotification } from '../../../lib/approval-notify-sync';
import {
  X, Check, Loader2, Search, FileText, Mail, Image as ImageIcon, ChevronRight, ChevronLeft,
  ChevronDown, CalendarDays, Banknote, CheckCircle2, Clock,
  TrendingUp, Receipt, Wallet, Home as HomeIcon, Trash2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../../lib/api';
import { useAutoRefresh } from '../../../lib/auto-refresh';
import { useAdminEvents } from '../../../lib/admin-events';
import { usePagedList, LoadMoreSentinel, useDebounced } from '../../../lib/use-paged-list';
import { useApiSWR } from '../../../lib/swr';
import { SendDialog } from '../../../components/EmailDialog';
import { KioskReceiptImageButton } from '../../../components/KioskReceiptImageButton';
import SignaturePad from '../../../components/SignaturePad';
import KeyboardSafeModal from '../../../components/KeyboardSafeModal';
import NumPad from '../../../components/NumPad';
import { playApproveConfirm, playErrorBuzz, playSwoosh } from '../../../lib/tap-sounds';

// =====================================================================
// Helpers
// =====================================================================
function fmtAmount(value, currency) {
  return fmtMoney(value, currency).replace(currency, '').trim();
}
// Versie zonder cent-decimalen — voor compacte stats (bv. "Vandaag" card).
function fmtAmountWhole(value) {
  return Number(value || 0).toLocaleString('nl-NL', { maximumFractionDigits: 0 });
}
function startOfDayUTC(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const METHOD_LABELS = {
  contant: 'Contant',
  bank: 'Bankoverschrijving',
  creditcard: 'Creditcard',
  ideal: 'iDEAL',
};

const CATEGORY_LABELS = {
  huur: 'Huur',
  servicekosten: 'Servicekosten',
  borg: 'Borg',
  boete: 'Boete',
  overig: 'Overig',
};

// =====================================================================
// KPI helpers
// =====================================================================
function KpiCard({ icon: Icon, label, value, hint, tone, testid }) {
  const tones = {
    orange: { iconBg: 'bg-orange-100', iconFg: 'text-[#FF5C00]' },
    green:  { iconBg: 'bg-emerald-100', iconFg: 'text-emerald-500' },
    blue:   { iconBg: 'bg-blue-100', iconFg: 'text-blue-600' },
  };
  const t = tones[tone] || tones.orange;
  return (
    <div className="flex-1 min-w-0 flex items-center gap-4 px-4 sm:px-5 py-4 sm:py-5" data-testid={testid}>
      <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center shrink-0 ${t.iconBg}`}>
        <Icon className={`w-5 h-5 ${t.iconFg}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] sm:text-xs font-semibold text-slate-500 mb-0.5 leading-tight">{label}</p>
        <p className="text-base sm:text-xl font-black text-slate-900 tracking-tight whitespace-nowrap">{value}</p>
        {hint && <p className="text-[10px] sm:text-xs text-slate-400 font-bold mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function MethodPill({ method }) {
  const tones = {
    contant: 'bg-emerald-50 text-emerald-700',
    bank: 'bg-blue-50 text-blue-700',
  };
  const cls = tones[method] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${cls}`}>
      {METHOD_LABELS[method] || method}
    </span>
  );
}

// Brand-aware status colors per betaalmethode — voorkomt dat alles eenheidsworst
// (groen) is en geeft betere visuele scan-baarheid in de mobiele lijst.
const METHOD_PILL_CLASSES = {
  contant: 'bg-orange-50 text-[#C74600]',
  bank:    'bg-slate-100 text-slate-700',
};

// =====================================================================
// PendingPaymentCard — zelfde stijl als MobilePaymentCard, maar met
// "Goedkeuren" knop ipv expand. Bedrag in oranje (waarschuwing kleur).
// =====================================================================
function PendingPaymentCard({ p, onApprove }) {
  return (
    <div data-testid={`pending-card-${p.id}`}
      className="bg-white rounded-2xl border border-amber-100 shadow-[0_1px_3px_-1px_rgba(245,158,11,0.15)] p-3 flex items-center gap-3 min-w-0">
      <TenantPhoto tenantId={p.tenant_id} name={p.tenant_name} size={42} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-extrabold text-slate-900 leading-tight truncate text-[15px]">
            {p.apartment_number || <span className="text-slate-400 italic">Geen appartement</span>}
          </p>
          {p.tenant_name && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 truncate max-w-[160px]">
              {p.tenant_name}
            </span>
          )}
        </div>
        <p className="text-slate-500 font-semibold truncate text-[11px] mt-0.5">
          Door <span className="text-slate-700 font-bold">{p.kiosk_employee_name || 'Kiosk'}</span> · {METHOD_LABELS[p.method] || p.method}
        </p>
        <p className="font-black text-amber-700 tracking-tight mt-0.5 text-[15px]">
          {p.currency} {fmtAmountWhole(p.amount)}
        </p>
      </div>
      <button onClick={onApprove} data-testid={`pending-approve-${p.id}`}
        className="shrink-0 h-10 px-3 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition shadow-[0_2px_6px_-2px_rgba(16,185,129,0.45)]">
        <CheckCircle2 className="w-4 h-4" /> Goedkeuren
      </button>
    </div>
  );
}


// =====================================================================
// ApprovePaymentSheet — bottom sheet met handtekening canvas + bevestig
// =====================================================================
export function ApprovePaymentSheet({ payment, onCancel, onApproved, modalClassName = '' }) {
  const [sig, setSig] = useState('');
  const [hasSig, setHasSig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Bottom sheet opent → subtiele swoosh
  useEffect(() => { playSwoosh(); }, []);

  const submit = async () => {
    if (!hasSig) { setErr('Teken eerst uw handtekening'); playErrorBuzz(); return; }
    setErr(''); setSaving(true);
    try {
      await api.post(`/payments/${payment.id}/approve`, { signature_data_url: sig });
      closeApprovalNotification(payment.id);
      playApproveConfirm();
      onApproved();
    } catch (e) { setErr(formatError(e)); playErrorBuzz(); }
    finally { setSaving(false); }
  };
  const reject = async () => {
    setErr(''); setSaving(true);
    try {
      await api.post(`/payments/${payment.id}/reject`, { reason: rejectReason });
      playApproveConfirm();
      onApproved();
    } catch (e) { setErr(formatError(e)); playErrorBuzz(); }
    finally { setSaving(false); }
  };

  return (
    <KeyboardSafeModal onClose={onCancel} testId="approve-modal" className={modalClassName}>
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">Goedkeuren</h3>
          <button onClick={onCancel} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3.5 mb-4 space-y-1.5 text-[13px]">
          <DetailRow label="Huurder" value={<span className="font-bold text-slate-900">{payment.tenant_name}</span>} />
          <DetailRow label="Bedrag" value={<span className="font-bold text-slate-900">{payment.currency} {fmtAmountWhole(payment.amount)}</span>} />
          <DetailRow label="Methode" value={METHOD_LABELS[payment.method] || payment.method} />
          <DetailRow label="Ontvangen door" value={payment.kiosk_employee_name || '—'} />
          {payment.method === 'bank' && (
            <>
              <DetailRow label="Land"
                value={<span className="font-bold">{payment.bank_country === 'SR' ? '🇸🇷 Suriname' : payment.bank_country === 'NL' ? '🇳🇱 Nederland' : '—'}</span>} />
              {payment.bank_statement_id && (
                <div className="pt-1">
                  <a href={`${process.env.REACT_APP_BACKEND_URL}/api/bank-statements/${payment.bank_statement_id}`}
                    target="_blank" rel="noreferrer"
                    data-testid="approve-stmt-download"
                    onClick={async (e) => {
                      // Auth header is required — fallback: download via fetch with token
                      e.preventDefault();
                      try {
                        const tk = localStorage.getItem('admin_token') || localStorage.getItem('kiosk_token');
                        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/bank-statements/${payment.bank_statement_id}`, {
                          headers: { Authorization: `Bearer ${tk}` },
                        });
                        if (!res.ok) throw new Error('Download mislukt');
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        window.open(url, '_blank');
                        setTimeout(() => URL.revokeObjectURL(url), 60000);
                      } catch (er) { alert(er.message || 'Bankafschrift kon niet geopend worden'); }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 font-bold text-xs hover:bg-sky-100">
                    📎 {payment.bank_statement_filename || 'Bankafschrift'} bekijken
                  </a>
                </div>
              )}
            </>
          )}
        </div>
        {payment.method === 'bank' && payment.ocr_status && (
          <div className={`rounded-2xl p-3 mb-4 border ${
            payment.ocr_status === 'matched'
              ? 'bg-emerald-50 border-emerald-200'
              : payment.ocr_status === 'mismatch'
              ? 'bg-amber-50 border-amber-200'
              : 'bg-rose-50 border-rose-200'
          }`} data-testid="approve-ocr-block">
            <p className="text-[10px] font-black uppercase tracking-widest mb-1.5"
              style={{ color: payment.ocr_status === 'matched' ? '#047857' : payment.ocr_status === 'mismatch' ? '#92400e' : '#9f1239' }}>
              🤖 OCR-controle
              {payment.ocr_confidence != null && (
                <span className="ml-2 opacity-75">· confidence {Math.round(payment.ocr_confidence * 100)}%</span>
              )}
            </p>
            {payment.ocr_status === 'matched' && (
              <p className="text-xs font-bold text-emerald-800">
                ✅ Bedrag, valuta en datum kloppen. Veilig om goed te keuren.
              </p>
            )}
            {payment.ocr_status === 'mismatch' && payment.ocr_mismatch_reasons && (
              <ul className="text-xs font-semibold text-amber-800 space-y-0.5">
                {payment.ocr_mismatch_reasons.map((r, i) => (
                  <li key={`${payment.id}-mism-${i}-${String(r).slice(0, 24)}`}>⚠️ {r}</li>
                ))}
              </ul>
            )}
            {payment.ocr_status === 'failed' && (
              <p className="text-xs font-semibold text-rose-700">
                OCR is niet gelukt — beoordeel handmatig.
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-[11px] text-slate-600">
              {payment.ocr_amount != null && <div><strong className="text-slate-800">Bedrag:</strong> {payment.ocr_currency || ''} {payment.ocr_amount}</div>}
              {payment.ocr_date_iso && <div><strong className="text-slate-800">Datum:</strong> {payment.ocr_date_iso}</div>}
              {payment.ocr_payer_name && <div className="col-span-2"><strong className="text-slate-800">Van:</strong> {payment.ocr_payer_name}</div>}
              {payment.ocr_beneficiary && <div className="col-span-2"><strong className="text-slate-800">Naar:</strong> {payment.ocr_beneficiary}</div>}
              {payment.ocr_reference && <div className="col-span-2"><strong className="text-slate-800">Kenmerk:</strong> {payment.ocr_reference}</div>}
            </div>
          </div>
        )}
        {!showReject ? (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Uw handtekening</p>
            <SignaturePad onChange={(url, has) => { setSig(url); setHasSig(has); }} height={170} />
            {err && <div className="mt-3 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{err}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowReject(true)} disabled={saving} data-testid="approve-reject-btn"
                className="px-3 h-12 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm">
                Afwijzen
              </button>
              <button onClick={submit} disabled={!hasSig || saving} data-testid="approve-confirm-btn"
                className="flex-1 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" /> Goedkeuren</>}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Reden voor afwijzing (optioneel)</p>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              data-testid="reject-reason" rows={3}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              placeholder="Bv. bedrag klopt niet, contant geld niet ontvangen…" />
            {err && <div className="mt-3 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{err}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowReject(false)} disabled={saving}
                className="px-3 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm">
                Terug
              </button>
              <button onClick={reject} disabled={saving} data-testid="reject-confirm-btn"
                className="flex-1 h-12 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Definitief afwijzen</>}
              </button>
            </div>
          </>
        )}
      </KeyboardSafeModal.Body>
    </KeyboardSafeModal>
  );
}


// =====================================================================
// Mobile-only (phone) views — geinspireerd op POS-terminal screenshot
// =====================================================================
function MobilePaymentCard({ p, onClick }) {
  // Op verzoek gebruiker (2026-02): appartement als hoofdtitel, huurder
  // als groene badge. Sub-lijn toont locatie + methode-pill onderaan.
  const aptTitle = p.apartment_number;
  const location = p.location_name || '';
  const methodCls = METHOD_PILL_CLASSES[p.method] || 'bg-slate-100 text-slate-700';
  return (
    <button onClick={onClick} type="button"
      data-testid={`mp-card-${p.id}`}
      className="w-full text-left bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_-2px_rgba(15,23,42,0.06)] active:scale-[0.99] transition-transform"
      style={{
        padding: 'clamp(11px, 3.4vw, 16px) clamp(13px, 3.8vw, 18px)',
      }}>
      <div className="flex items-center gap-3 min-w-0">
        <TenantPhoto tenantId={p.tenant_id} name={p.tenant_name} size={48} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-extrabold text-slate-900 leading-tight truncate"
              style={{ fontSize: 'clamp(15px, 4.2vw, 18px)' }}>
              {aptTitle || <span className="text-slate-400 italic">Geen appartement</span>}
            </p>
            {p.tenant_name && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 truncate max-w-[160px]">
                {p.tenant_name}
              </span>
            )}
          </div>
          {location && (
            <p className="text-slate-500 font-semibold truncate mt-0.5"
              style={{ fontSize: 'clamp(11px, 3vw, 13px)' }}>
              {location}
            </p>
          )}
          <div className="mt-1.5">
            <span className={`inline-block font-bold uppercase tracking-wider rounded-md ${methodCls}`}
              style={{
                fontSize: 'clamp(10px, 2.6vw, 11px)',
                padding: 'clamp(2px, 0.6vw, 3px) clamp(6px, 1.8vw, 9px)',
              }}>
              {METHOD_LABELS[p.method] || p.method}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
          <p className="font-black text-slate-900 tracking-tight whitespace-nowrap"
            data-testid={`mp-amount-${p.id}`}
            style={{ fontSize: 'clamp(15px, 4.2vw, 19px)' }}>
            {p.currency} {fmtAmountWhole(p.amount)}
          </p>
          {p.period_month && (
            <p className="text-slate-500 font-bold capitalize"
              style={{ fontSize: 'clamp(10px, 2.8vw, 12px)' }}>
              {MONTHS_NL[p.period_month - 1].slice(0, 3)} {p.period_year}
            </p>
          )}
          <ChevronRight className="text-slate-400/80 mt-0.5"
            style={{ width: 'clamp(14px, 3.8vw, 18px)', height: 'clamp(14px, 3.8vw, 18px)' }} />
        </div>
      </div>
    </button>
  );
}

// MobileTabPill, FilterMenu, Tab componenten verwijderd — we tonen
// nu standaard alleen de huidige maand met een MonthStepper voor navigatie.

// =====================================================================
// Payment row
// =====================================================================
function PaymentRow({ p, onOpen }) {
  // Op verzoek gebruiker (2026-02): appartement als hoofd-titel (net als
  // op de Huurders-tab), huurdernaam als groene badge. Sub-lijn toont
  // kwitantie · locatie · datum.
  const aptTitle = p.apartment_number;
  const location = p.location_name || '';
  const date = new Date(p.paid_at);
  const dateShort = date.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' });
  const statusBadge = (() => {
    const s = p.status || 'approved';
    if (s === 'pending_approval') return { l: 'Wacht', cls: 'bg-amber-100 text-amber-700' };
    if (s === 'rejected') return { l: 'Afgekeurd', cls: 'bg-red-100 text-red-700' };
    return null;
  })();
  return (
    <div onClick={() => onOpen(p)} data-testid={`payment-row-${p.id}`}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p); }}
      className="w-full text-left bg-white hover:bg-slate-50 active:bg-slate-100 rounded-2xl shadow-sm p-2.5 sm:p-4 flex items-center gap-2 sm:gap-3 border border-slate-100 cursor-pointer transition">
      <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-orange-50 text-[#FF5C00] flex items-center justify-center shrink-0">
        <Receipt className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-black text-slate-900 truncate">
            {aptTitle || <span className="text-slate-400 italic">Geen appartement</span>}
          </p>
          {p.tenant_name && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 truncate max-w-[220px]">
              {p.tenant_name}
            </span>
          )}
          {statusBadge && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${statusBadge.cls}`}>
              {statusBadge.l}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          <span className="font-mono font-bold text-slate-700">{p.receipt_number}</span>
          {location && <span> · {location}</span>}
          <span> · {dateShort}</span>
        </p>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
        <p className="text-sm sm:text-base font-black text-slate-900 whitespace-nowrap" data-testid={`payment-amount-${p.id}`}>
          {p.currency} {fmtAmountWhole(p.amount)}
        </p>
        {p.period_month && (
          <p className="text-[10px] text-slate-400 capitalize whitespace-nowrap">
            {MONTHS_NL[p.period_month - 1].slice(0, 3)} {p.period_year}
          </p>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// PaymentDetail — full-page detail EXACT in de stijl van PlanDetail:
// grote "Terug"-pil, hoofdcard met naam + bedrag, sub-cards voor
// betaalgegevens en gekoppelde factuur. Sub-card "Acties" onderaan.
// =====================================================================
function PaymentDetail({ payment, onBack, onEmail, onDelete, kioskMode = false }) {
  const p = payment;
  const [detailTab, setDetailTab] = useState('overzicht');
  const [linkedInvoice, setLinkedInvoice] = useState(null);
  // Openstaande facturen van deze huurder — voor "Wijzig gekoppelde factuur"
  const [tenantInvoices, setTenantInvoices] = useState([]);
  const [reassigning, setReassigning] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);

  useEffect(() => {
    if (!p?.invoice_id) return;
    let alive = true;
    (async () => {
      try {
        const { data: allInvs } = await api.get('/invoices');
        if (!alive) return;
        setLinkedInvoice(allInvs.find((i) => i.id === p.invoice_id) || null);
        // Toon huidige + open/partial van dezelfde huurder als opties
        setTenantInvoices(
          allInvs.filter((i) => i.tenant_id === p.tenant_id)
        );
      } catch (e) { console.warn('[Payments] linked invoice fetch:', e); }
    })();
    return () => { alive = false; };
  }, [p?.invoice_id, p?.tenant_id]);

  const handleReassign = async (newInvoiceId) => {
    if (!newInvoiceId || newInvoiceId === p.invoice_id) {
      setReassignOpen(false);
      return;
    }
    if (!(await hostConfirm('Wijzig de gekoppelde factuur van deze betaling? Beide facturen worden automatisch herberekend.'))) {
      return;
    }
    setReassigning(true);
    try {
      await api.post(`/payments/${p.id}/reassign-invoice`, { invoice_id: newInvoiceId });
      window.location.reload();
    } catch (e) {
      alert('Wijzigen mislukt: ' + (e?.response?.data?.detail || e.message));
    } finally {
      setReassigning(false);
      setReassignOpen(false);
    }
  };

  const date = new Date(p.paid_at);
  const statusBadge = (() => {
    const s = p.status || 'approved';
    if (s === 'pending_approval') return { l: 'Wacht op goedkeuring', cls: 'bg-amber-100 text-amber-700' };
    if (s === 'rejected') return { l: 'Afgekeurd', cls: 'bg-red-100 text-red-700' };
    return { l: 'Ontvangen', cls: 'bg-emerald-100 text-emerald-700' };
  })();

  return (
    <div className={kioskMode ? 'flex min-h-full flex-col gap-3 pb-3' : 'space-y-4 pb-24 sm:pb-6'}
      data-testid={`payment-detail-page-${p.id}`}>
      {kioskMode ? (
        <>
          <section className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:p-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#FF5C00]">
                <Receipt className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black uppercase tracking-widest text-[#FF5C00]">
                  Betaling{p.receipt_number ? ` · ${p.receipt_number}` : ''}
                </p>
                <h1 className="mt-0.5 truncate text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
                  {p.apartment_number || 'Geen appartement'}
                </h1>
                <p className="truncate text-sm font-semibold text-slate-500">
                  {p.tenant_name || 'Onbekende huurder'}{p.location_name ? ` · ${p.location_name}` : ''}
                </p>
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Bedrag</p>
                <p className="text-xl font-black text-slate-900">{fmtMoney(p.amount, p.currency)}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-black ${statusBadge.cls}`}>{statusBadge.l}</span>
              <button onClick={onBack} data-testid="payment-detail-back"
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <ArrowLeft className="h-4 w-4" /> Terug
              </button>
            </div>
          </section>
          <div className="flex shrink-0 gap-2 overflow-x-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-sm"
            role="tablist" aria-label="Betalingsdetails">
            {[
              ['overzicht', 'Overzicht'],
              ...(p.invoice_id ? [['factuur', 'Factuur']] : []),
              ['acties', 'Kwitantie en acties'],
            ].map(([tab, label]) => (
              <button key={tab} type="button" role="tab" aria-selected={detailTab === tab}
                onClick={() => setDetailTab(tab)} data-testid={`payment-detail-tab-${tab}`}
                className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold transition ${
                  detailTab === tab ? 'bg-[#FF5C00] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                }`}>
                {label}
              </button>
            ))}
          </div>
          {detailTab === 'overzicht' && p.note && (
            <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Notitie</p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-700">{p.note}</p>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button onClick={onBack} data-testid="payment-detail-back"
              className="flex items-center gap-1.5 text-slate-700 font-bold bg-white hover:bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
              <ArrowLeft className="w-4 h-4" /> Terug
            </button>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-slate-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-black text-slate-900 truncate">{p.apartment_number || 'Geen appartement'}</h1>
                <p className="text-xs text-slate-500">
                  {p.tenant_name || 'Onbekende huurder'}{p.location_name ? ` · ${p.location_name}` : ''}
                </p>
                {p.note && <p className="text-sm text-slate-600 mt-2">{p.note}</p>}
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${statusBadge.cls}`}>{statusBadge.l}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-orange-50 text-[#FF5C00]">
                    {CATEGORY_LABELS[p.category] || p.category}
                  </span>
                  <MethodPill method={p.method} />
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Betaald</p>
                <p className="text-2xl font-black text-slate-900">{fmtMoney(p.amount, p.currency)}</p>
                <p className="text-[11px] text-slate-500">op {date.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* SUB-CARD: BETAALGEGEVENS */}
      {(!kioskMode || detailTab === 'overzicht') && <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-base font-black text-slate-900">Betaalgegevens</h2>
        </div>
        <div className="p-4 space-y-1.5 text-sm">
          <DetailRow label="Kwitantienummer" value={<span className="font-mono font-bold text-slate-900">{p.receipt_number}</span>} />
          <DetailRow label="Datum" value={date.toLocaleString('nl-NL')} />
          <DetailRow label="Bedrag" value={fmtMoney(p.amount, p.currency)} />
          <DetailRow label="Methode" value={METHOD_LABELS[p.method] || p.method} />
          <DetailRow label="Categorie" value={CATEGORY_LABELS[p.category] || p.category || '—'} />
          {p.period_month && <DetailRow label="Periode" value={`${MONTHS_NL[p.period_month - 1]} ${p.period_year}`} />}
          {p.approved_by && <DetailRow label="Goedgekeurd door" value={p.approved_by} />}
        </div>
      </div>}

      {/* SUB-CARD: GEKOPPELDE FACTUUR (indien aanwezig) */}
      {(!kioskMode || detailTab === 'factuur') && p.invoice_id && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden" data-testid="payment-linked-invoice">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Gekoppelde factuur</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setReassignOpen((v) => !v)}
                disabled={reassigning}
                data-testid="payment-reassign-invoice-btn"
                className="text-[10px] font-bold text-[#FF5C00] hover:text-orange-700 uppercase tracking-wider px-2 py-1 rounded hover:bg-orange-50 disabled:opacity-40"
              >
                Wijzig
              </button>
              <span className="text-[10px] font-bold text-slate-400">1 factuur</span>
            </div>
          </div>
          {reassignOpen && (
            <div className="px-4 py-3 border-b border-slate-100 bg-orange-50/50" data-testid="payment-reassign-panel">
              <p className="text-xs font-bold text-slate-700 mb-2">Kies andere factuur:</p>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {tenantInvoices.length === 0 && (
                  <p className="text-xs text-slate-500">Geen andere facturen gevonden.</p>
                )}
                {tenantInvoices.map((inv) => {
                  const isCurrent = inv.id === p.invoice_id;
                  const amtNum = Number(inv.amount || 0);
                  const paidNum = Number(inv.paid_amount || 0);
                  const remNum = Math.max(0, amtNum - paidNum);
                  return (
                    <button
                      key={inv.id}
                      onClick={() => handleReassign(inv.id)}
                      disabled={reassigning || isCurrent}
                      data-testid={`payment-reassign-option-${inv.id}`}
                      className={`w-full text-left px-3 py-2 rounded-lg border-2 text-xs transition ${
                        isCurrent
                          ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                          : 'bg-white border-slate-200 hover:border-[#FF5C00] hover:bg-orange-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">
                          {inv.invoice_number}
                          <span className="ml-2 font-normal text-slate-500 capitalize">
                            {MONTHS_NL[(inv.period_month || 1) - 1]} {inv.period_year}
                          </span>
                          {isCurrent && (
                            <span className="ml-2 text-[9px] font-bold uppercase text-[#FF5C00]">Huidige</span>
                          )}
                        </span>
                        <span className="text-right shrink-0">
                          <span className="block font-bold text-slate-900">{fmtMoney(remNum, inv.currency)}</span>
                          <span className="block text-[9px] text-slate-500">open</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="px-4 py-3">
            {linkedInvoice ? (() => {
              const paid = Number(linkedInvoice.paid_amount || 0);
              const total = Number(linkedInvoice.amount || 0);
              const rem = Number(linkedInvoice.remaining_amount ?? Math.max(0, total - paid));
              const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
              const closed = (linkedInvoice.status || '').toLowerCase() === 'paid';
              return (
                <div>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      closed ? 'bg-emerald-100 text-emerald-600' : 'bg-orange-100 text-orange-600'
                    }`}>
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">
                        {linkedInvoice.invoice_number}
                        <span className="ml-2 text-xs font-normal text-slate-500 capitalize">
                          {MONTHS_NL[(linkedInvoice.period_month || 1) - 1]} {linkedInvoice.period_year}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {fmtMoney(paid, linkedInvoice.currency)} van {fmtMoney(total, linkedInvoice.currency)} betaald
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black text-slate-900 text-sm">{fmtMoney(rem, linkedInvoice.currency)}</p>
                      <p className="text-[10px] text-slate-400">{closed ? 'voldaan' : 'nog open'}</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${closed ? 'bg-emerald-500' : 'bg-gradient-to-r from-orange-400 to-orange-600'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })() : (
              <p className="text-sm text-slate-500">
                <span className="font-mono font-bold text-[#FF5C00]">{p.invoice_number}</span>
                {' '}(details worden geladen…)
              </p>
            )}
          </div>
        </div>
      )}

      {/* SUB-CARD: ACTIES */}
      {(!kioskMode || detailTab === 'acties') && <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-base font-black text-slate-900">Kwitantie en acties</h2>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <KioskReceiptImageButton paymentId={p.id} filename={`bon-${p.receipt_number || p.id}.jpg`}
            testId={`payment-image-${p.id}`}
            className="inline-flex items-center justify-center gap-2 px-2 py-2.5 bg-white border-2 border-slate-200 hover:border-slate-400 text-slate-700 font-bold rounded-xl text-xs sm:text-sm">
            <ImageIcon className="w-4 h-4" /> Bon JPG
          </KioskReceiptImageButton>
          <button onClick={() => onEmail(p)}
            data-testid={`payment-email-${p.id}`}
            className="inline-flex items-center justify-center gap-2 px-2 py-2.5 bg-white border-2 border-blue-300 hover:bg-blue-50 text-blue-700 font-bold rounded-xl text-xs sm:text-sm">
            <Mail className="w-4 h-4" /> Verstuur
          </button>
          <button onClick={() => { onDelete(p); onBack(); }}
            data-testid={`payment-delete-${p.id}`}
            className="inline-flex items-center justify-center gap-2 px-2 py-2.5 bg-white border-2 border-red-300 hover:bg-red-500 hover:text-white text-red-600 font-bold rounded-xl text-xs sm:text-sm transition">
            <Trash2 className="w-4 h-4" /> Verwijder
          </button>
        </div>
      </div>}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="row-label-value">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-semibold">{value}</span>
    </div>
  );
}

// =====================================================================
// Payment creation modal
// =====================================================================
function PaymentForm({ tenants, onCancel, onSaved, initialInvoice = null }) {
  const [data, setData] = useState(() => {
    const base = {
      tenant_id: '', amount: 0, currency: 'SRD', method: 'contant', category: 'huur',
      period_month: new Date().getMonth() + 1, period_year: new Date().getFullYear(), note: '',
    };
    if (initialInvoice) {
      return {
        ...base,
        tenant_id: initialInvoice.tenant_id,
        amount: initialInvoice.amount,
        currency: initialInvoice.currency || 'SRD',
        period_month: initialInvoice.period_month,
        period_year: initialInvoice.period_year,
        note: `Factuur ${initialInvoice.invoice_number}`,
      };
    }
    return base;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialInvoice) return; // bedrag al ingevuld vanuit factuur
    if (data.tenant_id) {
      const t = tenants.find((x) => x.id === data.tenant_id);
      if (t && t.rent_amount && data.category === 'huur') {
        setData((d) => ({ ...d, amount: t.rent_amount, currency: t.currency || 'SRD' }));
      }
    }
  }, [data.tenant_id, data.category, tenants, initialInvoice]);

  const save = async () => {
    setLoading(true); setError('');
    try {
      const payload = {
        ...data,
        amount: parseFloat(data.amount),
        // Huur én Vooruitbetaling zijn periode-gebonden zodat kwitantie/e-mail
        // en factuur-allocatie de doelmaand kennen. Overige categorieën
        // (borg, boete, servicekosten) hebben geen periode.
        period_month: (data.category === 'huur' || data.category === 'vooruitbetaling')
          ? parseInt(data.period_month) : null,
        period_year: (data.category === 'huur' || data.category === 'vooruitbetaling')
          ? parseInt(data.period_year) : null,
      };
      const { data: r } = await api.post('/payments', payload);
      onSaved(r);
    } catch (e) { setError(formatError(e)); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardSafeModal onClose={onCancel} testId="payment-modal" maxWidthClass="sm:max-w-lg">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">Nieuwe betaling</h3>
          <button onClick={onCancel} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        {error && <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Huurder *</label>
            <select value={data.tenant_id} onChange={(e) => setData({ ...data, tenant_id: e.target.value })} data-testid="pay-tenant" required
              className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
              <option value="">— Kies huurder —</option>
              {/* Sorteer op appartement-nummer (natural sort) en toon
                  format "HUIS 7A — Jan Pieterse" zodat de gebruiker
                  eerst het pand ziet en dan de naam. Huurders zonder
                  appartement zakken naar onderaan. */}
              {[...tenants]
                .sort((a, b) => {
                  const aptA = (a.apartment_number || '').toString();
                  const aptB = (b.apartment_number || '').toString();
                  if (!aptA && !aptB) return (a.name || '').localeCompare(b.name || '', 'nl', { sensitivity: 'base' });
                  if (!aptA) return 1;
                  if (!aptB) return -1;
                  return aptA.localeCompare(aptB, 'nl', { numeric: true, sensitivity: 'base' });
                })
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.apartment_number ? `${t.apartment_number} — ${t.name}` : `${t.name} (geen appartement)`}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Categorie</label>
              <select value={data.category} onChange={(e) => setData({ ...data, category: e.target.value })} data-testid="pay-category"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                <option value="huur">Huur</option>
                <option value="servicekosten">Servicekosten</option>
                <option value="borg">Borg</option>
                <option value="boete">Boete</option>
                <option value="overig">Overig</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Betaalwijze</label>
              <select value={data.method} onChange={(e) => setData({ ...data, method: e.target.value })} data-testid="pay-method"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                <option value="contant">Contant</option>
                <option value="bank">Bankoverschrijving</option>
              </select>
            </div>
          </div>
          {(data.category === 'huur' || data.category === 'vooruitbetaling') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Maand</label>
                <select value={data.period_month} onChange={(e) => setData({ ...data, period_month: e.target.value })}
                  data-testid="pay-month"
                  className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                  {MONTHS_NL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Jaar</label>
                <select value={data.period_year} onChange={(e) => setData({ ...data, period_year: e.target.value })}
                  data-testid="pay-year"
                  className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Bedrag *</label>
              <div className="w-full mt-1 h-14 px-4 rounded-xl border-2 border-[#FF5C00] bg-orange-50/40 flex items-center justify-between">
                <span className="text-slate-400 font-bold text-sm">{data.currency}</span>
                <span className="text-2xl font-black text-slate-900 tabular-nums" data-testid="pay-amount">
                  {data.amount || '0'}
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Valuta</label>
              <select value={data.currency} onChange={(e) => setData({ ...data, currency: e.target.value })} data-testid="pay-currency"
                className="w-full mt-1 h-14 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                <option value="SRD">SRD</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          {/* Custom NumPad — geen native toetsenbord = geen viewport shift. */}
          <NumPad
            value={String(data.amount || '')}
            onChange={(v) => setData({ ...data, amount: v })}
            testIdPrefix="pay-npad" />
        </div>
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-3">
        <button onClick={onCancel} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
        <button onClick={save} disabled={loading || !data.tenant_id || !data.amount}
          data-testid="pay-save"
          className="flex-1 h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
          Registreer betaling
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}

// =====================================================================
// Maand-stepper — pijltjes om maand vooruit/terug te navigeren
// =====================================================================
function MonthStepper({ year, month, onPrev, onNext, isCurrent, count, sum, currency, compact = false }) {
  const label = `${MONTHS_NL[month]} ${year}`;
  return (
    <div className={`flex items-center justify-between gap-2 bg-white rounded-2xl border border-orange-100 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}
      data-testid="month-stepper">
      <button type="button" onClick={onPrev} data-testid="month-prev"
        className="w-9 h-9 rounded-xl bg-slate-50 hover:bg-orange-50 active:scale-95 transition flex items-center justify-center text-slate-700">
        <ChevronLeft className="w-4 h-4" strokeWidth={2.4} />
      </button>
      <div className="flex-1 min-w-0 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight">
          {isCurrent ? 'Deze maand' : 'Maand'}
        </p>
        <p className="font-extrabold text-slate-900 capitalize tracking-tight leading-tight truncate"
          style={{ fontSize: 'clamp(14px, 4vw, 17px)' }} data-testid="month-stepper-label">
          {label}
        </p>
        {!compact && (
          <p className="text-[10px] text-slate-500 font-bold leading-tight mt-0.5">
            {count} betaling{count !== 1 ? 'en' : ''} · {currency} {fmtAmountWhole(sum)}
          </p>
        )}
      </div>
      <button type="button" onClick={onNext} data-testid="month-next"
        disabled={isCurrent}
        className="w-9 h-9 rounded-xl bg-slate-50 hover:bg-orange-50 disabled:opacity-40 disabled:hover:bg-slate-50 active:scale-95 transition flex items-center justify-center text-slate-700">
        <ChevronRight className="w-4 h-4" strokeWidth={2.4} />
      </button>
    </div>
  );
}

// FilterMenu en Tab componenten verwijderd — Payments toont nu altijd de
// huidige maand-filter; navigatie via MonthStepper.

// =====================================================================
// Main page
// =====================================================================
export default function Payments({ embedded = false, kioskLayout = false, onBack }) {
  // SWR cache: 3 endpoints parallel — bij tabwissel data instant uit cache
  const today = useMemo(() => new Date(), []);
  // Maand-picker — default = huidige maand. Pijltjes stappen 1 maand terug/vooruit.
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth()); // 0-11
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim());
  // Server-side: 25 betalingen per pagina binnen de gekozen maand; zoeken + totalen over de hele maand.
  const pagedParams = useMemo(() => ({
    start: new Date(selectedYear, selectedMonth, 1).toISOString(),
    end: new Date(selectedYear, selectedMonth + 1, 1).toISOString(),
    today_start: startOfDayUTC(today).toISOString(),
    q: debouncedSearch,
  }), [selectedYear, selectedMonth, today, debouncedSearch]);
  const paged = usePagedList('/payments/paged', pagedParams, { liveKey: '/payments' });
  const refetchP = paged.refetch;
  const { data: tenantsRaw, mutate: refetchT } = useApiSWR('/tenants');
  const { data: pendingRaw, mutate: refetchPend } = useApiSWR('/payments?status=pending_approval');
  const filteredItems = paged.items;
  const tenants = tenantsRaw || [];
  const pending = pendingRaw || [];
  const loading = paged.loading;
  const summary = paged.summary || {};
  const [approveFor, setApproveFor] = useState(null);
  const [creating, setCreating] = useState(false);
  const [emailing, setEmailing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [tab] = useState('month'); // altijd op Maand; vandaag-tab/methodes verwijderd
  const [detailPayment, setDetailPayment] = useState(null);
  // Melding aangetikt → open direct de betaling (of het goedkeuringsscherm).
  useDeepLink('payment', async (id) => {
    try {
      const { data } = await api.get(`/payments/${id}`);
      if (data.status === 'pending_approval') { setDetailPayment(null); setApproveFor(data); refetchPend(); }
      else setDetailPayment(data);
    } catch { /* betaling niet (meer) gevonden → lijst blijft staan */ }
  });
  const [expanded, setExpanded] = useState(null); // Alleen voor MOBILE inline-expand
  const toggleExpandMobile = (id) => setExpanded((cur) => (cur === id ? null : id));

  const load = useCallback(async () => {
    await Promise.all([refetchP(), refetchT(), refetchPend()]);
  }, [refetchP, refetchT, refetchPend]);
  // Aparte lichte refresh — alleen `pending_approval` fetchen. Wordt door
  // de 3s auto-refresh gebruikt zodat we niet elke 3s /payments én /tenants
  // meepakken (dat verspilde bandbreedte en veroorzaakte flikker op andere
  // tabs die dezelfde SWR-keys delen).
  const refreshPendingOnly = useCallback(() => {
    refetchPend();
  }, [refetchPend]);

  // Wanneer een admin de push-notificatie van een pending betaling
  // aanklikt landt hij hier met ?filter=pending in de URL. We scrollen
  // dan automatisch naar de "Wacht op goedkeuring" sectie en geven
  // een korte pulse-highlight zodat hij direct ziet waar te tikken.
  // Refresht ook direct (in plaats van wachten op 30s-poll) want de
  // pending list is hoogstwaarschijnlijk net gemuteerd.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('filter') !== 'pending') return;
    load();
    const tryScroll = () => {
      const el = document.querySelector('[data-testid="pending-section-desktop"]')
        || document.querySelector('[data-testid="pending-section"]');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('ring-4', 'ring-amber-400', 'ring-offset-2');
        setTimeout(() => el.classList.remove('ring-4', 'ring-amber-400', 'ring-offset-2'), 2400);
      }
    };
    // Wacht tot pending lijst is geladen + DOM gerendered.
    const t = setTimeout(tryScroll, 600);
    return () => clearTimeout(t);
  }, [load]);
  // Globale event-listener: andere componenten (zoals de QuickPay knop in
  // de top header, of de "Betaal"-knop op Facturen) kunnen `quick-pay-open`
  // dispatchen om de PaymentForm direct te openen. Werkt vanuit elke route.
  const [prefillInvoice, setPrefillInvoice] = useState(null);
  useEffect(() => {
    const onOpen = (e) => {
      setPrefillInvoice(e?.detail?.invoice || null);
      setDetailPayment(null);
      setCreating(true);
    };
    window.addEventListener('quick-pay-open', onOpen);
    return () => window.removeEventListener('quick-pay-open', onOpen);
  }, []);
  // Stille polling — snel (3s) zodat nieuwe pending betalingen vrijwel
  // realtime verschijnen ook als de SW push miss (bv. PWA in achtergrond
  // stond bij binnenkomst). Geen spinner / scroll-reset tijdens auto-refresh.
  // POLLING VERWIJDERD (per user verzoek 2026-02-28): geen 3s pending poll
  // meer. SSE `type==='notification'` + window focus refresh dekken instant
  // updates. Bij backend-restart of SSE disconnect valt LiveIndicator terug
  // op reconnect-logica.

  // Server-Sent Events — INSTANT push (~50ms latency) zodra de backend een
  // nieuwe pending betaling registreert. Veel sneller dan FCM/APNS WebPush.
  // Triggert direct een silent reload zodat de rij in UI verschijnt voordat
  // de notificatie pop-up ook maar half geanimeerd is.
  useAdminEvents((evt) => {
    // Backend broadcast type is 'change' voor iedere mutatie (POST/PUT/DELETE).
    // We reagerden voorheen alléén op 'notification' — dat werkte niet voor
    // reguliere betaal-mutaties vanaf andere apparaten, waardoor de UI niet
    // meer live bijgewerkt werd na de switch van polling → SSE.
    if (evt?.type === 'change' || evt?.type === 'notification') {
      load();
    }
  }, { enabled: !creating && !emailing });

  // Push-notificatie binnen → direct silent reload zodat de pending sectie
  // meteen up-to-date is (i.p.v. wachten op 3s poll). Triggert óók bij
  // window focus (zelfs zonder push) — perfect voor "PWA terug op de
  // voorgrond" scenario.
  useEffect(() => {
    const refresh = () => load();
    const onSwMsg = (ev) => {
      const t = ev?.data?.type;
      if (t === 'BADGE_CHANGED' || t === 'SW_ACTIVATED') refresh();
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMsg);
    }
    // Extra: dispatch ook bij elke focus/visibilitychange als safety net
    const onFocus = () => refresh();
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMsg);
      }
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);


  const stepMonth = (delta) => {
    const d = new Date(selectedYear, selectedMonth + delta, 1);
    setSelectedYear(d.getFullYear());
    setSelectedMonth(d.getMonth());
  };
  const isCurrentMonth = selectedYear === today.getFullYear() && selectedMonth === today.getMonth();
  const currency = summary.currency || 'SRD';
  const todaySum = summary.todaySum || 0;
  const totalCount = summary.totalCount || 0;

  const toggleExpand = toggleExpandMobile;

  // Rijen starten altijd DICHT — de gebruiker klapt zelf open wanneer nodig.
  // (De eerdere "auto-open newest" gedraging is verwijderd op verzoek zodat
  //  de lijst rustig oogt en alle rijen consistent zijn.)

  // Detail-page routing: bij klik op een betaling openen we een aparte
  // pagina (analoog aan PlanDetail in Betalingsregelingen). Terug-knop
  // sluit en herlaadt. Verzenden/Verwijderen-modals staan buiten deze
  // if-branch zodat ze ook geopend kunnen worden vanuit de detail-view.
  if (detailPayment) {
    return (
      <div className={kioskLayout
        ? 'h-full w-full bg-[#FF5C00] flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0'
        : ''} style={kioskLayout ? { paddingLeft: '1.5vw', paddingRight: '1.5vw' } : undefined}
        data-testid={kioskLayout ? 'kiosk-payment-detail' : undefined}>
        <div className={kioskLayout ? 'flex-1 min-h-0 overflow-y-auto py-3' : ''}>
          <div className={kioskLayout ? 'mx-auto flex min-h-full max-w-7xl flex-col gap-3' : ''}>
            <PaymentDetail
              payment={detailPayment}
              kioskMode={kioskLayout}
              onBack={() => { setDetailPayment(null); load(); }}
              onEmail={(item) => setEmailing(item)}
              onDelete={(item) => setDeleting(item)}
            />
          </div>
        </div>
        {emailing && (
          <SendDialog
            documentType="payment"
            documentId={emailing.id}
            documentLabel="kwitantie"
            title={`Kwitantie ${emailing.receipt_number} verzenden`}
            tenantEmail={tenants.find((t) => t.id === emailing.tenant_id)?.email || ''}
            tenantPhone={tenants.find((t) => t.id === emailing.tenant_id)?.phone || ''}
            tenantName={emailing.tenant_name}
            onClose={() => setEmailing(null)} />
        )}
      </div>
    );
  }

  return (
    <div data-testid="payments-page" className={kioskLayout ? 'h-full w-full' : embedded ? 'space-y-4' : ''}>
      {kioskLayout ? (
        <div className="h-full w-full bg-[#FF5C00] flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0"
          style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }} data-testid="kiosk-payments-panel">
          <div className="kiosk-chrome md:hidden flex items-center justify-between gap-2 px-1 sm:px-2 py-2 shrink-0">
            {onBack ? (
              <button onClick={onBack} data-testid="payments-panel-back"
                className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 active:scale-95 transition">
                <ArrowLeft className="w-4 h-4" /> <span className="text-xs">Terug</span>
              </button>
            ) : <span />}
            <div className="text-right text-white">
              <p className="text-sm font-semibold">Betalingen</p>
              <p className="text-[10px] opacity-70">Betalingsoverzicht</p>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 sm:gap-3 pb-3 md:pt-3 overflow-hidden">
            <section className="bg-white rounded-2xl md:flex-[2] md:order-2 flex flex-col p-2.5 sm:p-6 shrink-0 md:shrink md:overflow-y-auto"
              data-testid="payments-summary">
              <div className="row-label-value items-center mb-2 sm:mb-4">
                <h2 className="text-base sm:text-2xl font-black text-slate-900 tracking-tight">Betalingen</h2>
                <Banknote className="h-4 w-4 sm:h-5 sm:w-5 text-[#FF5C00]" />
              </div>

              <MonthStepper year={selectedYear} month={selectedMonth}
                onPrev={() => stepMonth(-1)} onNext={() => stepMonth(1)}
                isCurrent={isCurrentMonth}
                count={summary.monthCount || 0} sum={summary.monthSum || 0} currency={currency} />

              <div className="mt-2 rounded-2xl bg-orange-50 p-2.5 sm:mt-4 sm:p-4">
                <p className="text-[11px] font-semibold text-slate-500 sm:text-sm">Totaal deze maand</p>
                <p className="mt-0.5 break-words text-base font-black text-slate-900 tabular-nums sm:mt-1 sm:text-2xl"
                  data-testid="payments-month-total">{fmtMoney(summary.monthSum || 0, currency)}</p>
              </div>

              <div className="grid grid-cols-2 gap-1.5 mt-1.5 sm:mt-3 sm:gap-3">
                <div className="rounded-2xl bg-slate-50 p-2 sm:p-4">
                  <p className="text-[10px] font-bold text-slate-500 sm:text-xs">Betalingen</p>
                  <p className="mt-0.5 text-lg font-black text-slate-900 sm:mt-1 sm:text-2xl" data-testid="payments-month-count">
                    {summary.monthCount || 0}
                  </p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-2 sm:p-4">
                  <p className="text-[10px] font-bold text-amber-700 sm:text-xs">Te keuren</p>
                  <p className="mt-0.5 text-lg font-black text-amber-800 sm:mt-1 sm:text-2xl" data-testid="payments-pending-count">
                    {pending.length}
                  </p>
                </div>
              </div>

              <div className="mt-1.5 rounded-2xl bg-slate-50 p-2 sm:mt-3 sm:p-4">
                <p className="text-[11px] font-semibold text-slate-500 sm:text-sm">Vandaag</p>
                <p className="mt-0.5 text-base font-black text-slate-900 tabular-nums sm:mt-1 sm:text-lg">
                  {fmtMoney(todaySum, currency)}
                </p>
              </div>

              {onBack && (
                <button type="button" onClick={onBack} data-testid="payments-panel-back-desktop"
                  className="mt-4 hidden min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50 md:inline-flex">
                  <ArrowLeft className="h-4 w-4" /> Terug
                </button>
              )}
            </section>

            <section className="bg-white rounded-2xl md:flex-[3] md:order-1 flex flex-col p-2.5 sm:p-5 min-w-0 overflow-hidden"
              data-testid="payments-recent">
              <div className="row-label-value items-center mb-2 sm:mb-3">
                <h3 className="text-sm sm:text-lg font-black text-slate-900 tracking-tight">Recente betalingen</h3>
                <span className="text-xs font-bold text-slate-500 bg-slate-100 rounded-xl px-2.5 py-1">
                  {totalCount} kwitanties
                </span>
              </div>

              <div className="relative mb-2 sm:mb-3">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Zoek huurder, kwitantie of appartement…"
                  data-testid="payment-search"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-xs outline-none focus:border-[#FF5C00] sm:h-11 sm:text-sm" />
              </div>

              {pending.length > 0 && (
                <section className="mb-3 shrink-0 rounded-2xl border border-amber-200 bg-amber-50 p-3"
                  data-testid="pending-section-desktop">
                  <div className="mb-2 flex items-center gap-2 px-1 text-xs font-black uppercase tracking-widest text-amber-700">
                    <Clock className="h-4 w-4" /> Wacht op goedkeuring · {pending.length}
                  </div>
                  <div className="max-h-52 space-y-2 overflow-y-auto">
                    {pending.map((p) => (
                      <PendingPaymentCard key={p.id} p={p} onApprove={() => setApproveFor(p)} />
                    ))}
                  </div>
                </section>
              )}

              {loading ? (
                <div className="flex-1 rounded-2xl border border-slate-100 bg-white p-10 text-center">
                  <Loader2 className="mx-auto h-7 w-7 animate-spin text-[#FF5C00]" />
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="flex-1 rounded-2xl border border-slate-100 bg-white p-8 text-center" data-testid="payments-empty">
                  <Receipt className="mx-auto mb-2 h-9 w-9 text-orange-300" />
                  <p className="text-sm font-semibold text-slate-500">
                    {totalCount === 0 ? 'Nog geen betalingen.' : 'Geen resultaten voor deze maand of zoekopdracht.'}
                  </p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 space-y-1.5 overflow-y-auto -mx-1 px-1 pb-14 sm:space-y-2 md:pb-0">
                  {filteredItems.map((p) => (
                    <PaymentRow key={p.id} p={p} onOpen={setDetailPayment} />
                  ))}
                  <LoadMoreSentinel active={paged.hasMore || paged.loadingMore}
                    onVisible={paged.loadMore} testid="payments-load-more" />
                </div>
              )}
            </section>
          </div>
        </div>
      ) : embedded ? (
        <>
          <FxStats testId="payment-fx-stats" items={[
            ['Totaal maand', fmtMoney(summary.monthSum || 0, currency), 'green'],
            ['Betalingen', summary.monthCount || 0, 'orange'],
            ['Te keuren', pending.length, 'amber']]} />
          <div className="flex gap-1.5" data-testid="payment-month-bar">
            <button type="button" onClick={() => stepMonth(-1)} data-testid="payment-month-prev" aria-label="Vorige maand"
              className="w-12 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><ChevronLeft className="w-4 h-4" /></button>
            <div className="flex-1 h-10 rounded-xl bg-[#FF5C00] text-white text-xs font-black flex items-center justify-center capitalize" data-testid="payment-month-label">
              {MONTHS_NL[selectedMonth]} {selectedYear}
            </div>
            <button type="button" onClick={() => stepMonth(1)} disabled={isCurrentMonth} data-testid="payment-month-next" aria-label="Volgende maand"
              className="w-12 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <FxSearch value={search} onChange={setSearch} placeholder="Zoek huurder, kwitantie of appartement…" testId="payment-search" />
          {pending.map((p) => (
            <FxRow key={p.id} testId={`pending-card-${p.id}`} tenantId={p.tenant_id} onClick={() => setApproveFor(p)} title={p.apartment_number || 'Geen appartement'}
              sub={`${p.tenant_name || 'Onbekende huurder'}${p.receipt_number ? ` · ${p.receipt_number}` : ''}`}
              meta={p.paid_at ? new Date(p.paid_at).toLocaleString('nl-NL') : undefined}
              amount={fmtMoney(p.amount, p.currency)} status="Te keuren" tone="amber" />
          ))}
          {loading ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-[#FF5C00] animate-spin" /></div>
            : filteredItems.length === 0 ? <FxEmpty text={totalCount === 0 ? 'Nog geen betalingen.' : 'Geen betalingen gevonden.'} testId="payments-empty" />
            : filteredItems.map((p) => (
              <FxRow key={p.id} testId={`payment-row-${p.id}`} tenantId={p.tenant_id} onClick={() => setDetailPayment(p)} title={p.apartment_number || 'Geen appartement'}
                sub={`${p.tenant_name || 'Onbekende huurder'}${p.receipt_number ? ` · ${p.receipt_number}` : ''}`}
                meta={`${p.paid_at ? new Date(p.paid_at).toLocaleDateString('nl-NL') : ''}${p.method ? ` · ${METHOD_LABELS[p.method] || p.method}` : ''}`}
                amount={fmtMoney(p.amount, p.currency)} status={CATEGORY_LABELS[p.category] || 'Betaald'} tone="green" />
            ))}
          <LoadMoreSentinel active={paged.hasMore || paged.loadingMore} onVisible={paged.loadMore} testid="payments-load-more" />
        </>
      ) : (<>
      {/* =================================================================
          MOBILE (phone) — POS-terminal stijl. Verborgen vanaf md (>=768px).
          ================================================================= */}
      <div className="md:hidden space-y-4" data-testid="payments-mobile">
        <div className={`${embedded ? 'hidden' : 'flex'} items-center justify-between gap-2`}>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900">Betalingen</h1>
            <p className="text-sm text-slate-500 mt-0.5 truncate">
              {totalCount} kwitantie{totalCount !== 1 ? 's' : ''}
              {todaySum > 0 ? ` · Vandaag ${currency} ${fmtAmountWhole(todaySum)}` : ''}
            </p>
          </div>
        </div>

        {tab === 'month' && (
          <MonthStepper year={selectedYear} month={selectedMonth}
            onPrev={() => stepMonth(-1)} onNext={() => stepMonth(1)}
            isCurrent={isCurrentMonth}
            count={summary.monthCount || 0} sum={summary.monthSum || 0} currency={currency} />
        )}

        {/* PENDING APPROVAL — sectie bovenaan, vóór de approved-lijst.
            Alleen zichtbaar als er pending betalingen wachten op goedkeuring.
            Bedragen tellen NIET mee in "Vandaag" / "Maand" totalen. */}
        {pending.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 shadow-[0_1px_4px_-2px_rgba(245,158,11,0.20)]" data-testid="pending-section">
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Wacht op goedkeuring · {pending.length}
              </p>
            </div>
            <div className="space-y-2">
              {pending.map((p) => (
                <PendingPaymentCard key={p.id} p={p} onApprove={() => setApproveFor(p)} />
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-2xl border border-orange-100 p-10 text-center">
            <Loader2 className="w-6 h-6 text-orange-400 animate-spin mx-auto" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-2xl border border-orange-100 p-8 text-center" data-testid="mp-empty">
            <Receipt className="w-9 h-9 text-orange-300 mx-auto mb-2" />
            <p className="text-[13px] text-slate-500 font-bold">
              {totalCount === 0 ? 'Nog geen betalingen.' : 'Geen resultaten voor deze filter.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredItems.map((p) => (
              <div key={p.id} data-testid={`mp-row-${p.id}`}>
                <MobilePaymentCard p={p} onClick={() => toggleExpand(p.id)} />
                {expanded === p.id && (
                  <div className="mt-1.5 mb-1 px-1.5" data-testid={`mp-detail-${p.id}`}>
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3.5 space-y-2 text-[12px]">
                      <DetailRow label="Kwitantie" value={<span className="font-mono font-bold">{p.receipt_number}</span>} />
                      {p.invoice_number && (
                        <DetailRow label="Factuur" value={<span className="font-mono font-bold text-[#FF5C00]">{p.invoice_number}</span>} />
                      )}
                      <DetailRow label="Datum" value={new Date(p.paid_at).toLocaleString('nl-NL')} />
                      <DetailRow label="Categorie" value={CATEGORY_LABELS[p.category] || p.category} />
                      <DetailRow label="Methode" value={METHOD_LABELS[p.method] || p.method} />
                      {p.period_month && (
                        <DetailRow label="Periode" value={`${MONTHS_NL[p.period_month - 1]} ${p.period_year}`} />
                      )}
                      {p.approved_by && (
                        <DetailRow label="Goedgekeurd door" value={p.approved_by} />
                      )}
                      {p.note && <DetailRow label="Notitie" value={p.note} />}
                      <div className="grid grid-cols-3 gap-1.5 pt-2">
                        <KioskReceiptImageButton paymentId={p.id} filename={`bon-${p.receipt_number || p.id}.jpg`}
                          testId={`mp-image-${p.id}`}
                          className="inline-flex items-center justify-center gap-1 px-1.5 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-[11px]">
                          <ImageIcon className="w-3.5 h-3.5" /> Bon JPG
                        </KioskReceiptImageButton>
                        <button onClick={() => setEmailing(p)} type="button"
                          data-testid={`mp-email-${p.id}`}
                          className="inline-flex items-center justify-center gap-1 px-1.5 py-2 bg-white border border-blue-200 text-blue-700 font-bold rounded-xl text-[11px]">
                          <Mail className="w-3.5 h-3.5" /> Mail
                        </button>
                        <button onClick={() => setDeleting(p)} type="button"
                          data-testid={`mp-delete-${p.id}`}
                          className="inline-flex items-center justify-center gap-1 px-1.5 py-2 bg-white border border-red-200 text-red-600 font-bold rounded-xl text-[11px]">
                          <Trash2 className="w-3.5 h-3.5" /> Wis
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <LoadMoreSentinel active={paged.hasMore || paged.loadingMore} onVisible={paged.loadMore} testid="mp-load-more" />
          </div>
        )}
      </div>

      {/* =================================================================
          TABLET + DESKTOP (>=768px) — ongewijzigde layout.
          ================================================================= */}
      <div className="hidden md:block space-y-4 sm:space-y-5">
      {/* HEADER — compact layout matching Betalingsregelingen: titel +
          subtitle + primaire knop op dezelfde rij. Vroeger stond er een
          3xl-4xl titel + de knop op een aparte rij, wat "gedrongen"
          aanvoelde. Nu is het rustiger en consistent met de rest van de
          admin-app. */}
      <div className={`${embedded ? 'hidden' : 'flex'} items-center justify-between gap-3 flex-nowrap`}>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight truncate">Betalingen</h1>
          <p className="text-sm text-slate-500 mt-0.5 truncate">
            {totalCount} kwitantie{totalCount === 1 ? '' : 's'} geregistreerd — beoordeel betalingen die op goedkeuring wachten.
          </p>
        </div>
      </div>

      {/* KPI-kaarten op desktop bewust verwijderd op verzoek — pagina blijft
          strak. Mobile houdt zijn "Vandaag" mini-card wel (verderop). */}

      {/* PENDING APPROVAL — desktop variant. Tonen vóór de approved-lijst
          zodat beheerder direct ziet wat z'n medewerkers indienen. */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-[0_1px_4px_-2px_rgba(245,158,11,0.20)]" data-testid="pending-section-desktop">
          <div className="flex items-center justify-between mb-3 px-1">
            <p className="text-[11px] font-black uppercase tracking-widest text-amber-700 inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              Wacht op goedkeuring · {pending.length}
            </p>
          </div>
          <div className="space-y-2">
            {pending.map((p) => (
              <PendingPaymentCard key={p.id} p={p} onApprove={() => setApproveFor(p)} />
            ))}
          </div>
        </div>
      )}

      {/* TAB BAR — verborgen op mobiel/desktop; we tonen alleen de maand-stepper hieronder */}

      {tab === 'month' && (
        <MonthStepper year={selectedYear} month={selectedMonth}
          onPrev={() => stepMonth(-1)} onNext={() => stepMonth(1)}
          isCurrent={isCurrentMonth}
          count={summary.monthCount || 0} sum={summary.monthSum || 0} currency={currency} />
      )}

      {/* SEARCH */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Zoek huurder, kwitantienummer, appartement..."
          data-testid="payment-search"
          className="w-full h-12 pl-11 pr-4 rounded-2xl bg-white border border-orange-100 text-sm focus:border-[#FF5C00] outline-none" />
      </div>

      {/* Geen column-header meer — we gebruiken de card-lijst layout van
          Betalingsregelingen waar elke kaart z'n eigen labels/badges bevat. */}

      {/* ROWS */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-orange-100 p-10 text-center">
          <Loader2 className="w-7 h-7 text-orange-400 animate-spin mx-auto" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-orange-100 p-10 text-center" data-testid="payments-empty">
          <Receipt className="w-10 h-10 text-orange-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold">
            {totalCount === 0 ? 'Nog geen betalingen.' : 'Geen resultaten voor deze filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2 sm:space-y-2.5">
          {filteredItems.map((p) => (
            <PaymentRow key={p.id} p={p} onOpen={setDetailPayment} />
          ))}
          <LoadMoreSentinel active={paged.hasMore || paged.loadingMore} onVisible={paged.loadMore} testid="payments-load-more" />
        </div>
      )}
      </div>
      </>)}

      {/* MODALS */}
      {creating && <PaymentForm tenants={tenants} initialInvoice={prefillInvoice}
        onCancel={() => { setCreating(false); setPrefillInvoice(null); }}
        onSaved={() => { setCreating(false); setPrefillInvoice(null); load(); }} />}
      {approveFor && (
        <ApprovePaymentSheet
          payment={approveFor}
          onCancel={() => setApproveFor(null)}
          onApproved={() => { setApproveFor(null); load(); }}
        />
      )}
      {emailing && (
        <SendDialog
          documentType="payment"
          documentId={emailing.id}
          documentLabel="kwitantie"
          title={`Kwitantie ${emailing.receipt_number} verzenden`}
          tenantEmail={tenants.find((t) => t.id === emailing.tenant_id)?.email || ''}
          tenantPhone={tenants.find((t) => t.id === emailing.tenant_id)?.phone || ''}
          tenantName={emailing.tenant_name}
          onClose={() => setEmailing(null)} />
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          data-testid="payment-delete-modal" onClick={() => !deleteBusy && setDeleting(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 bg-red-500 text-white">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-6 h-6" />
                <p className="text-lg font-extrabold">Betaling verwijderen?</p>
              </div>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-slate-700">
                Je staat op het punt betaling <span className="font-mono font-bold">{deleting.receipt_number}</span> van
                <span className="font-bold"> {deleting.tenant_name}</span> ter waarde van
                <span className="font-bold"> {fmtMoney(deleting.amount, deleting.currency)}</span> permanent te verwijderen.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <p className="font-bold mb-1">Belangrijk:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>De <b>gekoppelde factuur(en)</b> worden ook verwijderd (mits er geen andere betalingen aan hangen).</li>
                  <li>Indien meerdere betalingen aan dezelfde factuur hangen, wordt alleen het bedrag teruggedraaid.</li>
                  <li>Gekoppelde betalingsregeling-termijnen worden teruggezet naar "open".</li>
                </ul>
              </div>
              <p className="text-xs text-red-600 font-bold">
                Deze actie kan niet ongedaan gemaakt worden.
              </p>
            </div>
            <div className="px-6 py-4 bg-slate-50 flex gap-2 border-t border-slate-100">
              <button onClick={() => setDeleting(null)} disabled={deleteBusy}
                data-testid="payment-delete-cancel"
                className="flex-1 py-2.5 rounded-lg bg-white border-2 border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-100 disabled:opacity-50">
                Annuleren
              </button>
              <button onClick={async () => {
                setDeleteBusy(true);
                try {
                  await api.delete(`/payments/${deleting.id}`);
                  setDeleting(null);
                  load();
                } catch (e) {
                  alert(formatError(e) || 'Kon betaling niet verwijderen');
                } finally {
                  setDeleteBusy(false);
                }
              }} disabled={deleteBusy}
                data-testid="payment-delete-confirm"
                className="flex-[2] py-2.5 rounded-lg bg-red-500 text-white font-bold text-sm hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {deleteBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Definitief verwijderen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* eslint-disable no-unused-vars */
// Houd CalendarDays + CheckCircle2 imports voor toekomstige uitbreidingen.
const _unused = [CalendarDays, CheckCircle2];
