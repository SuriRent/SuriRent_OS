import { useState, useEffect, useCallback, useRef } from 'react';
import { readSeed, writeSeed } from '../../../lib/swr';
import {
  CheckCircle2, AlertCircle, ArrowUp, ArrowDown, Loader2, Landmark, Banknote, Copy, Check,
  Upload, FileCheck2, ScanLine, CreditCard, Receipt, ShieldAlert, Crown,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, formatError } from '../../../lib/api';
import { useAutoRefresh } from '../../../lib/auto-refresh';

const fmt = (n, c = 'SRD') => {
  const cur = (c || 'SRD').toUpperCase();
  if (cur === 'EUR') return `€${Number(n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${cur} ${Number(n || 0).toLocaleString('nl-NL')}`;
};
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const isOpen = (i) => !['paid', 'superseded', 'cancelled', 'void'].includes(i.status);
const intervalLabel = (interval) => ({
  quarter: 'kwartaal',
  year: 'jaar',
  lifetime: 'eenmalig',
  once: 'eenmalig',
}[interval] || 'maand');
const METHOD_LABEL = { creditcard: 'Creditcard', ideal: 'iDEAL', bank: 'Bank', stripe: 'Stripe', contant: 'Contant' };
const CARD = 'bg-white rounded-2xl border border-slate-200 shadow-sm';

function StatusPill({ tone, children }) {
  const t = {
    green: 'bg-emerald-50 text-emerald-700 [&>i]:bg-emerald-500',
    orange: 'bg-orange-50 text-orange-700 [&>i]:bg-orange-500',
    red: 'bg-red-50 text-red-600 [&>i]:bg-red-500',
    slate: 'bg-slate-100 text-slate-500 [&>i]:bg-slate-400',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-md ${t}`}>
      <i className="w-1.5 h-1.5 rounded-full" />{children}
    </span>
  );
}

function PayButtons({ invoiceId, onPay, size = 'lg' }) {
  const base = size === 'lg' ? 'h-11 px-5 rounded-xl text-sm' : 'h-8 px-2.5 rounded-lg text-[11px]';
  const ic = size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  const suffix = size === 'lg' ? '' : `-${invoiceId}`;
  const prefix = size === 'lg' ? 'saas-pay' : 'my-invoice';
  return (
    <div className="flex gap-2">
      <button onClick={() => onPay(invoiceId, 'card')} data-testid={size === 'lg' ? 'saas-pay-card-btn' : `${prefix}-card${suffix}`}
        className={`${base} bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold inline-flex items-center justify-center gap-1.5 shadow-[0_10px_25px_-8px_rgba(255,92,0,0.5)] active:scale-[0.98] transition-transform`}>
        <CreditCard className={ic} /> Creditcard
      </button>
      <button onClick={() => onPay(invoiceId, 'ideal')} data-testid={size === 'lg' ? 'saas-pay-ideal-btn' : `${prefix}-ideal${suffix}`}
        className={`${base} bg-white border-2 border-[#CC0066]/25 hover:border-[#CC0066] text-[#CC0066] font-bold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform`}>
        <Landmark className={ic} /> iDEAL
      </button>
    </div>
  );
}

function PayBanner({ me, openInvoices, stripeOn, bankOn, onPayMany, onBankPay }) {
  const [sel, setSel] = useState(() => new Set(openInvoices.map((i) => i.id)));
  const key = openInvoices.map((i) => i.id).join(',');
  useEffect(() => { setSel(new Set(openInvoices.map((i) => i.id))); }, [key]);
  if (openInvoices.length === 0) {
    return (
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center gap-4" data-testid="saas-all-paid">
        <span className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow"><CheckCircle2 className="w-6 h-6" /></span>
        <div>
          <p className="text-sm font-black text-slate-900">Alles is betaald</p>
          <p className="text-xs text-slate-500">Er staan geen facturen open. Nieuwe facturen verschijnen hier automatisch.</p>
        </div>
      </div>
    );
  }
  const chosen = openInvoices.filter((i) => sel.has(i.id));
  const total = chosen.reduce((s, i) => s + Number(i.amount || 0), 0);
  const cur = openInvoices[0].currency;
  const urgent = me.status === 'expired' || openInvoices.length > 1;
  const toggle = (id) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = chosen.length === openInvoices.length;
  return (
    <div className={`${CARD} relative overflow-hidden`} data-testid="saas-online-pay-box">
      <span aria-hidden className={`absolute left-0 inset-y-0 w-1 ${urgent ? 'bg-red-500' : 'bg-[#FF5C00]'}`} />
      <div className="px-5 pt-4 pb-3 flex items-center gap-3">
        <span className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${urgent ? 'bg-red-100 text-red-500' : 'bg-orange-100 text-orange-500'}`}>
          <Receipt className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-slate-900">
            {me.status === 'expired' ? 'Uw abonnement is verlopen' : openInvoices.length > 1 ? `${openInvoices.length} facturen staan open` : 'Openstaande factuur'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Kies welke facturen u nu wilt betalen.</p>
        </div>
        {openInvoices.length > 1 && (
          <button onClick={() => setSel(allOn ? new Set() : new Set(openInvoices.map((i) => i.id)))} data-testid="saas-pay-select-all"
            className="text-xs font-bold text-[#FF5C00] hover:underline shrink-0">{allOn ? 'Niets selecteren' : 'Alles selecteren'}</button>
        )}
      </div>
      <div className="mx-5 rounded-xl border border-orange-100 divide-y divide-orange-50">
        {openInvoices.map((i) => (
          <label key={i.id} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-orange-50/40 transition-colors" data-testid={`saas-pay-row-${i.id}`}>
            <input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} className="w-4 h-4 accent-[#FF5C00]"
              data-testid={`saas-pay-check-${i.id}`} />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-bold text-slate-900 truncate">{fmtDate(i.period_start)} → {fmtDate(i.period_end)}</span>
              <span className="block text-[11px] text-slate-400"><span className="capitalize">{i.plan}</span>{i.autopay_failed && <span className="text-red-500 font-semibold"> · automatische betaling mislukt</span>}</span>
            </span>
            <span className="text-sm font-black text-slate-900 tabular-nums">{fmt(i.amount, i.currency)}</span>
          </label>
        ))}
      </div>
      <div className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1">
          <p className="text-[11px] font-semibold text-slate-500">Totaal te betalen ({chosen.length})</p>
          <p className="text-xl font-black text-slate-900 tracking-tight tabular-nums" data-testid="saas-pay-amount">{fmt(total, cur)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stripeOn && (
            <div className={chosen.length ? '' : 'opacity-40 pointer-events-none'}>
              <PayButtons onPay={(_, m) => onPayMany(chosen.map((i) => i.id), m)} />
            </div>
          )}
          {bankOn && (
            <button type="button" onClick={() => onBankPay(chosen[0].id)} disabled={chosen.length !== 1}
              data-testid="saas-pay-bank-btn"
              className="h-11 px-4 rounded-xl border-2 border-slate-200 hover:border-[#FF5C00] hover:bg-orange-50 text-slate-800 font-bold text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Landmark className="w-4 h-4" /> Bankoverschrijving
            </button>
          )}
        </div>
        {bankOn && chosen.length !== 1 && (
          <p className="text-[11px] text-slate-500">Selecteer precies één factuur voor betaling via bankoverschrijving.</p>
        )}
        {!stripeOn && !bankOn && <p className="text-xs text-slate-500">Neem contact op met SuriRent om uw factuur te betalen.</p>}
      </div>
    </div>
  );
}

function AutopayCard({ autopay, stripeOn, hasOpen, onToggle, onRemove, onSetup, busy }) {
  if (!stripeOn) return null;
  const card = autopay?.card;
  return (
    <div className={`${CARD} px-5 py-4 flex flex-col md:flex-row md:items-center gap-4`} data-testid="autopay-card">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${autopay?.enabled ? 'bg-emerald-100 text-emerald-500' : 'bg-slate-100 text-slate-400'}`}>
          <CreditCard className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black text-slate-900">Automatisch betalen</p>
          <p className="text-xs text-slate-500 mt-0.5" data-testid="autopay-status">
            {card
              ? <>{autopay.enabled ? 'Aan' : 'Uit'} · <span className="capitalize">{card.brand}</span> •••• {card.last4} · verloopt {String(card.exp_month).padStart(2, '0')}/{String(card.exp_year).slice(-2)}</>
              : 'Bewaar uw creditcard bij een betaling — nieuwe facturen worden dan direct afgeschreven.'}
          </p>
        </div>
      </div>
      {card ? (
        <div className="flex items-center gap-3">
          <button onClick={() => onToggle(!autopay.enabled)} disabled={busy} data-testid="autopay-toggle" aria-pressed={autopay.enabled}
            className={`relative w-12 h-7 rounded-full transition-colors ${autopay.enabled ? 'bg-[#FF5C00]' : 'bg-slate-300'} disabled:opacity-50`}>
            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-[left] ${autopay.enabled ? 'left-6' : 'left-1'}`} />
          </button>
          <button onClick={onRemove} disabled={busy} data-testid="autopay-remove"
            className="text-xs font-bold text-slate-500 hover:text-red-600 transition-colors">Kaart verwijderen</button>
        </div>
      ) : hasOpen ? (
        <button onClick={onSetup} data-testid="autopay-setup"
          className="h-10 px-4 rounded-xl bg-white border-2 border-orange-200 hover:bg-orange-50 text-[#FF6A1A] font-bold text-sm transition-colors shrink-0">
          Betalen & kaart bewaren
        </button>
      ) : null}
    </div>
  );
}

function InvoicesPanel({ invoices, stripeOn, bankOn, onPay, onBankPay }) {
  if (invoices.length === 0) return (
    <div className="p-10 flex flex-col items-center gap-3 text-center">
      <span className="w-16 h-16 rounded-3xl bg-orange-50 text-[#FF5C00] flex items-center justify-center"><Receipt className="w-8 h-8" /></span>
      <p className="text-base font-black text-slate-900">Nog geen facturen</p>
      <p className="text-sm text-slate-500">Zodra er een factuur is, verschijnt die hier.</p>
    </div>
  );
  return (
    <div data-testid="my-invoices-list">
      <div className="hidden md:grid grid-cols-[1.4fr_1fr_1fr_0.9fr_auto] gap-4 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-orange-100">
        <span>Periode</span><span>Pakket</span><span className="text-right">Bedrag</span><span>Status</span><span className="w-[190px] text-right">Actie</span>
      </div>
      <div className="divide-y divide-orange-50">
        {invoices.map((inv) => {
          const paid = inv.status === 'paid';
          const open = isOpen(inv);
          const balanceDue = inv.balance_due ?? Math.max(Number(inv.amount || 0) - Number(inv.paid_amount || 0), 0);
          return (
            <div key={inv.id} data-testid={`my-invoice-${inv.id}`}
              className="px-5 py-3.5 grid grid-cols-[1fr_auto] md:grid-cols-[1.4fr_1fr_1fr_0.9fr_auto] gap-x-4 gap-y-1 items-center hover:bg-orange-50/40 transition-colors">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}</p>
                {inv.due_date && <p className="text-[11px] font-semibold text-orange-600">Uiterlijk betalen: {fmtDate(inv.due_date)}</p>}
                <p className="text-[11px] text-slate-400 font-mono">#{(inv.invoice_number || inv.id.slice(0, 8)).toUpperCase()}</p>
              </div>
              <p className="hidden md:block text-sm text-slate-600 capitalize">{inv.plan}</p>
              <div className="text-right">
                <p className="text-sm font-black text-slate-900 tabular-nums">{fmt(inv.amount, inv.currency)}</p>
                {balanceDue > 0 && balanceDue < Number(inv.amount || 0)
                  && <p className="text-[11px] font-semibold text-slate-500">Open: {fmt(balanceDue, inv.currency)}</p>}
              </div>
              <div className="md:block">
                <StatusPill tone={paid ? 'green' : open ? 'orange' : 'slate'}>
                  {paid ? 'Betaald' : open && balanceDue < Number(inv.amount || 0) ? 'Gedeeltelijk betaald' : open ? 'Open' : 'Vervallen'}
                </StatusPill>
              </div>
              <div className="md:w-[190px] flex md:justify-end justify-end">
                {open && (stripeOn || bankOn) ? <div className="flex flex-wrap justify-end gap-1">
                  {stripeOn && <PayButtons invoiceId={inv.id} onPay={onPay} size="sm" />}
                  {bankOn && <button type="button" onClick={() => onBankPay(inv.id)} data-testid={`my-invoice-bank-${inv.id}`}
                    className="h-8 px-2.5 rounded-lg text-[11px] border border-slate-200 hover:border-[#FF5C00] text-slate-700 font-bold inline-flex items-center gap-1">
                    <Landmark className="w-3.5 h-3.5" /> Bank
                  </button>}
                </div>
                  : <span className="text-[11px] text-slate-400">{paid ? `Betaald ${fmtDate(inv.paid_at)}` : ''}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PaymentsPanel({ payments }) {
  if (payments.length === 0) return (
    <div className="p-10 flex flex-col items-center gap-3 text-center">
      <span className="w-16 h-16 rounded-3xl bg-orange-50 text-[#FF5C00] flex items-center justify-center"><CreditCard className="w-8 h-8" /></span>
      <p className="text-base font-black text-slate-900">Nog geen betalingen</p>
      <p className="text-sm text-slate-500">Uw betalingen verschijnen hier.</p>
    </div>
  );
  return (
    <div className="divide-y divide-orange-50" data-testid="my-payments-list">
      {payments.map((p) => (
        <div key={p.id} className="px-5 py-3.5 flex items-center gap-3" data-testid={`my-payment-${p.id}`}>
          <span className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-500 flex items-center justify-center shrink-0"><Banknote className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">{fmtDate(p.paid_at)}</p>
            <p className="text-[11px] text-slate-400 truncate">{p.reference || p.note || '—'}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-black text-slate-900 tabular-nums">{fmt(p.amount, p.currency)}</p>
            <StatusPill tone="green">{METHOD_LABEL[p.method] || p.method}</StatusPill>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlanCard({ plan, currentPlanId, onSelect, busy }) {
  const isCurrent = plan.id === currentPlanId;
  return (
    <div className={`relative rounded-2xl p-5 flex flex-col border transition-[border-color,box-shadow] ${
      isCurrent ? 'border-[#FF5C00] bg-orange-50/40 shadow-[0_10px_25px_-12px_rgba(255,92,0,0.45)]' : 'border-orange-100 bg-white hover:border-orange-300'}`}
      data-testid={`plan-card-${plan.id}`}>
      {isCurrent && <span className="absolute top-4 right-4 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#FF5C00] text-white">Huidig</span>}
      <p className="text-base font-black text-slate-900">{plan.name}</p>
      <p className="text-xs text-slate-500 mt-0.5 pr-14">{plan.description}</p>
      <p className="text-2xl font-black text-slate-900 mt-4 tracking-tight">{fmt(plan.amount, plan.currency)}<span className="text-xs font-semibold text-slate-400 ml-1">/ {intervalLabel(plan.interval)}</span></p>
      <ul className="mt-3 space-y-1.5 flex-1">
        {(plan.features || []).map((f) => (
          <li key={f} className="flex items-start gap-2 text-[13px] text-slate-600"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{f}</li>
        ))}
      </ul>
      {!isCurrent && (
        <button onClick={() => onSelect(plan)} disabled={busy} data-testid={`plan-select-${plan.id}`}
          className="mt-4 w-full h-10 rounded-xl bg-white border-2 border-orange-200 hover:bg-orange-50 text-[#FF6A1A] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : plan.amount > 0 ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
          Kies {plan.name}
        </button>
      )}
    </div>
  );
}

function BankProofUploader({ invoice, onSuccess, onErr }) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const hasOpenInstallments = (invoice?.payment_plans || []).some((plan) =>
    (plan.schedule || []).some((term) => term.status !== 'paid' && Number(term.paid_amount || 0) < Number(term.amount || 0)),
  );

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { onErr('Bestand groter dan 5 MB'); return; }
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (invoice?.id) fd.append('invoice_id', invoice.id);
      const { data } = await api.post('/billing/me/bank-confirm', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
      if (data.status === 'paid') onSuccess?.();
    } catch (err) { onErr(formatError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col h-full" data-testid="saas-bank-proof-uploader">
      <div className="flex items-center gap-2 mb-1.5">
        <ScanLine className="w-4 h-4 text-[#FF5C00]" />
        <p className="text-sm font-black text-slate-900">Betaalbewijs uploaden</p>
      </div>
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        {invoice
          ? hasOpenInstallments
            ? 'Upload het betaalbewijs van de eerstvolgende termijn of van het volledige openstaande saldo. Wij controleren bedrag, datum en omschrijving automatisch.'
            : 'Wij controleren automatisch bedrag, datum en omschrijving. Bij een match wordt uw betaling verwerkt.'
          : 'Na je bankoverschrijving maken we bij het uploaden automatisch de eerste factuur aan. Bij een match wordt je abonnement direct geactiveerd.'}
      </p>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onFile} className="hidden" data-testid="saas-bank-proof-input" />
      {!result && (
        <button onClick={() => fileInput.current?.click()} disabled={busy} data-testid="saas-bank-proof-upload-btn"
          className="mt-auto w-full h-24 rounded-2xl border-2 border-dashed border-orange-200 hover:border-[#FF5C00] hover:bg-orange-50/50 text-slate-600 hover:text-[#FF5C00] font-bold text-sm flex flex-col items-center justify-center gap-1 disabled:opacity-50 transition-colors">
          {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Scannen…</> : <><Upload className="w-5 h-5" /> Upload betaalbewijs<span className="text-[10px] font-semibold text-slate-400">JPG, PNG, WEBP of PDF · max 5 MB</span></>}
        </button>
      )}
      {result?.status === 'paid' && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-start gap-2" data-testid="saas-bank-proof-result-paid">
          <FileCheck2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-900 font-bold leading-snug">
            {result.invoice_paid
              ? 'Betaling automatisch goedgekeurd. De factuur is voldaan.'
              : 'Termijnbetaling automatisch goedgekeurd. Het resterende saldo blijft op dezelfde factuur staan.'}
            <p className="font-normal text-emerald-700 mt-1">Herkend: {result.ocr?.currency || ''} {result.ocr?.amount?.toFixed(2) || '?'}{result.ocr?.date_iso && ` · ${result.ocr.date_iso}`}</p>
          </div>
        </div>
      )}
      {result?.status === 'pending_approval' && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2" data-testid="saas-bank-proof-result-pending">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-snug">
            <p className="font-bold">Wacht op handmatige goedkeuring.</p>
            <ul className="font-normal text-amber-800 mt-1 ml-4 list-disc">{(result.mismatch_reasons || []).slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        </div>
      )}
      {result && <button onClick={() => setResult(null)} className="mt-2 text-xs text-slate-500 hover:text-slate-700 font-medium self-start" data-testid="saas-bank-proof-retry">Opnieuw uploaden</button>}
    </div>
  );
}

function KV({ label, value, mono, onCopy, copied, wrap }) {
  return (
    <div className="row-label-value items-center py-2.5 border-b border-orange-50 last:border-0">
      <span className="text-slate-500 text-[13px]">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className={`font-bold text-slate-900 text-[13px] ${wrap ? 'break-words whitespace-normal text-right' : 'truncate'} ${mono ? 'font-mono' : ''}`}>{value}</span>
        {onCopy && (
          <button onClick={onCopy} title="Kopiëren" className="p-1.5 rounded-lg text-slate-400 hover:text-[#FF5C00] hover:bg-orange-50 transition-colors shrink-0">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function BankPanel({ details, invoice, amount, currency, company, onSuccess, onErr }) {
  const [copied, setCopied] = useState('');
  const nextInstallment = (invoice?.payment_plans || [])
    .flatMap((plan) => (plan.schedule || []).map((term) => ({ plan, term })))
    .filter(({ term }) => term.status !== 'paid' && Number(term.amount || 0) > Number(term.paid_amount || 0))
    .sort((a, b) => (a.term.due_date || '').localeCompare(b.term.due_date || '') || a.term.seq - b.term.seq)[0];
  const refText = `ABONNEMENT — ${company} — ${invoice ? new Date(invoice.created_at).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }) : 'huidige maand'}`;
  const paymentAmount = invoice
    ? fmt(nextInstallment
      ? Number(nextInstallment.term.amount) - Number(nextInstallment.term.paid_amount || 0)
      : invoice.balance_due ?? Math.max(Number(invoice.amount || 0) - Number(invoice.paid_amount || 0), 0), invoice.currency)
    : fmt(amount, currency);
  const copy = (label, value) => { navigator.clipboard.writeText(value || ''); setCopied(label); setTimeout(() => setCopied(''), 1500); };
  return (
    <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6 [&>*]:min-w-0" data-testid="saas-bank-box">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Landmark className="w-4 h-4 text-[#FF5C00]" />
          <p className="text-sm font-black text-slate-900">Overschrijvingsgegevens</p>
        </div>
        <KV label="Bank" value={details.bank_name} />
        <KV label="Tenaamstelling" value={details.account_name} onCopy={() => copy('account_name', details.account_name)} copied={copied === 'account_name'} />
        <KV label="Rekeningnummer" value={details.account_number} mono onCopy={() => copy('account_number', details.account_number)} copied={copied === 'account_number'} />
        {details.swift && <KV label="SWIFT" value={details.swift} mono onCopy={() => copy('swift', details.swift)} copied={copied === 'swift'} />}
        {paymentAmount && <KV label={nextInstallment ? `Termijn ${nextInstallment.term.seq}/${nextInstallment.plan.installments}` : 'Bedrag'} value={paymentAmount} mono />}
        {(nextInstallment?.term.due_date || invoice?.due_date) && (
          <KV label={nextInstallment ? 'Termijn vervalt op' : 'Uiterlijk betalen op'}
            value={fmtDate(nextInstallment?.term.due_date || invoice.due_date)} />
        )}
        <KV label="Omschrijving" value={refText} mono wrap onCopy={() => copy('ref', refText)} copied={copied === 'ref'} />
        {(details.whatsapp || details.support_email) && (
          <p className="text-[11px] text-slate-500 mt-3">
            Vragen? {details.whatsapp && <>WhatsApp <a href={`https://wa.me/${(details.whatsapp || '').replace(/\D/g, '')}`} className="text-[#FF5C00] font-bold">{details.whatsapp}</a> · </>}
            {details.support_email && <>E-mail <a href={`mailto:${details.support_email}`} className="text-[#FF5C00] font-bold">{details.support_email}</a></>}
          </p>
        )}
      </div>
      <BankProofUploader invoice={invoice} onSuccess={onSuccess} onErr={onErr} />
    </div>
  );
}

export default function MijnAbonnement() {
  const seed = readSeed('/billing/me:bundle');
  const [me, setMe] = useState(seed?.me ?? null);
  const [plans, setPlans] = useState(seed?.plans ?? []);
  const [bank, setBank] = useState(seed?.bank ?? null);
  const [invoices, setInvoices] = useState(seed?.invoices ?? []);
  const [payments, setPayments] = useState(seed?.payments ?? []);
  const [loading, setLoading] = useState(!seed);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [stripeOn, setStripeOn] = useState(() => !!readSeed('/saas-stripe/public-config'));
  const [tab, setTab] = useState('invoices');
  const [autopay, setAutopay] = useState(() => readSeed('/billing/me/autopay') || null);
  const [apBusy, setApBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (new URLSearchParams(location.search).get('tab') === 'bank') {
      setTab('bank');
    }
  }, [location.search]);

  useEffect(() => {
    api.get('/saas-stripe/public-config').then(({ data }) => setStripeOn(!!writeSeed('/saas-stripe/public-config', data?.enabled ? 1 : 0))).catch(() => setStripeOn(false));
  }, []);

  const goPay = (invoiceId, method) => {
    const back = encodeURIComponent(location.pathname + location.hash);
    navigate(`/saas/checkout/${invoiceId || 'open'}?method=${method}&back=${back}`);
  };

  const goBankPay = (invoiceId) => {
    const back = encodeURIComponent(location.pathname + location.hash);
    navigate(`/saas/bank-checkout/${invoiceId}?back=${back}`);
  };

  const payMany = (ids, method, save) => {
    const back = encodeURIComponent(location.pathname + location.hash);
    navigate(`/saas/checkout/selectie?ids=${ids.join(',')}&method=${method}${save ? '&save=1' : ''}&back=${back}`);
  };

  const apCall = async (fn) => {
    setApBusy(true); setErr('');
    try { const { data } = await fn(); setAutopay(data); } catch (e) { setErr(formatError(e)); } finally { setApBusy(false); }
  };

  const load = useCallback(async () => {
    api.get('/billing/me/autopay').then(({ data }) => setAutopay(writeSeed('/billing/me/autopay', data))).catch(() => {});
    try {
      const [m, p, b, inv, pay] = await Promise.all([
        api.get('/billing/me'), api.get('/billing/me/plans'), api.get('/billing/bank-details'),
        api.get('/billing/me/invoices'), api.get('/billing/me/payments'),
      ]);
      setMe(m.data); setPlans(p.data); setBank(b.data); setInvoices(inv.data); setPayments(pay.data);
      writeSeed('/billing/me:bundle', { me: m.data, plans: p.data, bank: b.data, invoices: inv.data, payments: pay.data });
    } catch (e) { setErr(formatError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const changePlan = async (plan) => {
    const word = plan.amount > (me?.monthly_amount || 0) ? 'opwaarderen' : 'downgraden';
    if (!window.confirm(`Pakket ${word} naar ${plan.name} (${fmt(plan.amount, plan.currency)} / ${intervalLabel(plan.interval)})?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const { data } = await api.put('/billing/me/plan', { plan: plan.id });
      setMsg(data.effective === 'immediately' ? `Pakket gewijzigd naar ${plan.name}.`
        : `Pakketwijziging gepland — gaat in bij volgende vernieuwing op ${fmtDate(data.renews_at)}.`);
      setTimeout(() => setMsg(''), 5000);
      await load();
    } catch (e) { setErr(formatError(e)); } finally { setBusy(false); }
  };

  const cancelSub = async () => {
    if (!window.confirm('Weet u het zeker? Uw abonnement wordt direct opgezegd en u verliest toegang tot uw omgeving.')) return;
    try { await api.post('/companies/me/cancel-subscription'); window.location.reload(); } catch (e) { setErr(formatError(e, 'Opzeggen mislukt')); }
  };

  if (loading || !me) return <div className="py-16 flex items-center justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;

  const openInvoices = invoices.filter(isOpen);
  const sortedOpen = [...openInvoices].sort((a, b) => String(a.period_start || a.created_at).localeCompare(String(b.period_start || b.created_at)));
  const oldestOpen = sortedOpen[0];
  const showBank = !!bank && (me.currency || 'SRD') === 'SRD';

  return (
    <div className="space-y-6" data-testid="mijn-abonnement">
      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm" data-testid="my-sub-error">{err}</div>}
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-sm" data-testid="my-sub-msg">{msg}</div>}

      {(() => {
        const plan = plans.find((p) => p.id === me.plan_id);
        const label = { active: 'Actief', trial: 'Proefperiode', expired: 'Verlopen' }[me.status] || me.status;
        return (
          <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#FF8A3D] via-[#FF6A1A] to-[#E05200] p-6 text-white shadow-[0_12px_30px_-12px_rgba(224,82,0,0.6)]" data-testid="my-sub-hero">
            <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
            <div className="pointer-events-none absolute -left-10 -bottom-20 h-48 w-48 rounded-full bg-black/10 blur-2xl" />
            <div className="relative flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30"><Crown className="h-7 w-7 text-white" /></span>
                <div className="min-w-0">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-white/70">Huidig pakket</p>
                  <p className="text-3xl font-black tracking-tight truncate">{plan?.name || 'Abonnement'}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-black text-[#E05200] shadow">{label}</span>
            </div>
            <div className="relative mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/15 p-4 ring-1 ring-white/20">
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/70">Prijs</p>
                <p className="mt-1 text-2xl font-black tabular-nums">{me.monthly_amount != null ? fmt(me.monthly_amount, me.currency) : '—'}<span className="text-xs font-semibold text-white/70"> / {intervalLabel(plan?.interval)}</span></p>
              </div>
              <div className="rounded-2xl bg-white/15 p-4 ring-1 ring-white/20">
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/70">Vernieuwing</p>
                <p className="mt-1 text-2xl font-black">{me.renews_at ? fmtDate(me.renews_at) : '—'}</p>
              </div>
            </div>
          </header>
        );
      })()}

      <section aria-label="Betalingen en facturen" className={`grid grid-cols-1 gap-4 [&>*]:min-w-0 ${stripeOn ? 'xl:grid-cols-5' : ''}`}>
        <div className={stripeOn ? 'xl:col-span-3' : ''}>
          <PayBanner me={me} openInvoices={sortedOpen} stripeOn={stripeOn} bankOn={showBank}
            onPayMany={payMany} onBankPay={goBankPay} />
        </div>
        {stripeOn && (
          <div className="xl:col-span-2">
            <AutopayCard autopay={autopay} stripeOn={stripeOn} hasOpen={sortedOpen.length > 0} busy={apBusy}
              onToggle={(v) => apCall(() => api.put('/billing/me/autopay', { enabled: v }))}
              onRemove={() => { if (window.confirm('Opgeslagen kaart verwijderen en automatisch betalen uitzetten?')) apCall(() => api.delete('/billing/me/autopay')); }}
              onSetup={() => payMany(sortedOpen.map((i) => i.id), 'card', true)} />
          </div>
        )}
      </section>

      <nav aria-label="Abonnementsbeheer" className="flex items-center gap-2 overflow-x-auto rounded-2xl bg-orange-50 p-1.5 no-scrollbar" data-testid="my-sub-tabs">
        {[
          ['invoices', `Facturen (${invoices.length})`, 'my-sub-tab-invoices', Receipt],
          ['payments', `Betalingen (${payments.length})`, 'my-sub-tab-payments', CreditCard],
          ['plans', 'Pakket wijzigen', 'my-sub-tab-plans', Crown],
          ...(showBank ? [['bank', 'Bankoverschrijving', 'my-sub-tab-bank', Landmark]] : []),
        ].map(([v, lbl, tid, Icon]) => (
          <button key={v} type="button" onClick={() => setTab(v)} data-testid={tid}
            className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-3 text-sm font-extrabold transition-all ${tab === v ? 'bg-[#FF5C00] text-white shadow-md' : 'text-slate-600 hover:bg-white'}`}>
            <Icon className="h-4 w-4" />{lbl}
          </button>
        ))}
      </nav>

      <div className="bg-white rounded-3xl border border-orange-100 shadow-sm overflow-hidden" data-testid={`my-sub-panel-${tab}`}>
        {tab === 'invoices' && <InvoicesPanel invoices={invoices} stripeOn={stripeOn} bankOn={showBank}
          onPay={goPay} onBankPay={goBankPay} />}
        {tab === 'payments' && <PaymentsPanel payments={payments} />}
        {tab === 'plans' && (
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {plans.map((p) => <PlanCard key={p.id} plan={p} currentPlanId={me.plan_id} onSelect={changePlan} busy={busy} />)}
            </div>
            <p className="text-xs text-slate-400 mt-4">Tijdens de proefperiode treedt de wijziging direct in werking. Bij een actief abonnement geldt de nieuwe prijs vanaf de volgende vernieuwing.</p>
          </div>
        )}
        {tab === 'bank' && showBank && (
          <BankPanel details={bank} invoice={oldestOpen} amount={me.monthly_amount} currency={me.currency} company={me.company_name || 'UW BEDRIJF'}
            onSuccess={() => { setMsg('Betaling automatisch goedgekeurd — abonnement is geactiveerd!'); load(); }} onErr={setErr} />
        )}
      </div>

      {(me.status === 'trial' || me.status === 'active') && (
        <div className="rounded-2xl border border-red-100 bg-red-50/40 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-red-100 text-red-500 flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5" /></span>
          <div className="flex-1">
            <p className="text-sm font-black text-slate-900">Abonnement opzeggen</p>
            <p className="text-xs text-slate-500 mt-0.5">Toegang wordt direct geblokkeerd. Uw data blijft 90 dagen bewaard zodat u kunt heractiveren.</p>
          </div>
          <button onClick={cancelSub} data-testid="cancel-subscription-btn"
            className="h-10 px-4 rounded-xl border-2 border-red-200 text-red-600 hover:bg-red-50 font-bold text-sm transition-colors shrink-0">
            Abonnement opzeggen
          </button>
        </div>
      )}
    </div>
  );
}
