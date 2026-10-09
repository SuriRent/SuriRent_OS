import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2, AlertCircle, ArrowUp, ArrowDown, Loader2, Landmark, Banknote, Copy, Check, Crown,
  Upload, FileCheck2, ScanLine, CreditCard, Receipt, ShieldAlert, AlertTriangle, Clock,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, formatError } from '../../../lib/api';
import { useAutoRefresh } from '../../../lib/auto-refresh';
import { Tab, KpiCard } from './invoices/kpi';

const fmt = (n, c = 'SRD') => {
  const cur = (c || 'SRD').toUpperCase();
  if (cur === 'EUR') return `€${Number(n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${cur} ${Number(n || 0).toLocaleString('nl-NL')}`;
};
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const isOpen = (i) => !['paid', 'superseded', 'cancelled', 'void'].includes(i.status);
const METHOD_LABEL = { creditcard: 'Creditcard', ideal: 'iDEAL', bank: 'Bank', stripe: 'Stripe', contant: 'Contant' };
const STATUS_LABEL = { trial: 'Proefperiode', active: 'Actief', expired: 'Verlopen', cancelled: 'Opgezegd' };
const CARD = 'bg-white rounded-2xl border border-orange-100';

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

const KPI_TONE = {
  orange: 'bg-orange-100 text-orange-500', green: 'bg-emerald-100 text-emerald-500', red: 'bg-red-100 text-red-500',
};

function MiniKpi({ icon: Icon, label, value, hint, tone, testid }) {
  return (
    <div className="bg-white p-3.5 min-w-0" data-testid={`${testid}-m`}>
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${KPI_TONE[tone]}`}><Icon className="w-3.5 h-3.5" /></span>
        <p className="text-[11px] font-semibold text-slate-500 truncate">{label}</p>
      </div>
      <p className="text-base font-black text-slate-900 tracking-tight mt-2 truncate">{value}</p>
      {hint && <p className={`text-[11px] font-bold mt-0.5 truncate ${tone === 'red' ? 'text-red-500' : 'text-slate-400'}`}>{hint}</p>}
    </div>
  );
}

function KpiStrip({ me, openInvoices, openTotal, lastPayment }) {
  const expired = me.status === 'expired';
  const statusHint = me.status === 'trial' ? `Nog ${me.days_left ?? '—'} dagen · t/m ${fmtDate(me.trial_ends_at)}`
    : me.status === 'active' ? `Vernieuwt ${fmtDate(me.renews_at)}`
      : expired ? 'Betaling vereist' : fmtDate(me.cancelled_at);
  const items = [
    { icon: Crown, label: 'Huidig pakket', value: me.plan?.name || '—', hint: `${fmt(me.monthly_amount, me.currency)} / maand`, tone: 'orange', testid: 'my-sub-kpi-plan' },
    { icon: expired ? AlertTriangle : me.status === 'trial' ? Clock : CheckCircle2, label: 'Status', value: STATUS_LABEL[me.status] || me.status,
      hint: statusHint, tone: expired ? 'red' : me.status === 'active' ? 'green' : 'orange', testid: 'my-sub-kpi-status' },
    { icon: Receipt, label: 'Openstaand', value: fmt(openTotal, me.currency),
      hint: openInvoices.length ? `${openInvoices.length} factu${openInvoices.length === 1 ? 'ur' : 'ren'} open` : 'Alles betaald',
      tone: openTotal > 0 ? 'red' : 'green', testid: 'my-sub-kpi-open' },
    { icon: Banknote, label: 'Laatste betaling', value: lastPayment ? fmtDate(lastPayment.paid_at) : 'Nog geen',
      hint: lastPayment ? `${fmt(lastPayment.amount, lastPayment.currency)} · ${METHOD_LABEL[lastPayment.method] || lastPayment.method}` : '',
      tone: 'green', testid: 'my-sub-kpi-last' },
  ];
  return (
    <div data-testid="my-sub-status">
      <div className="md:hidden grid grid-cols-2 gap-px bg-orange-100 rounded-2xl border border-orange-100 overflow-hidden">
        {items.map((k) => <MiniKpi key={k.testid} {...k} />)}
      </div>
      <div className="hidden md:grid grid-cols-2 xl:grid-cols-4 gap-px bg-orange-100 rounded-2xl border border-orange-100 overflow-hidden [&_.capitalize]:normal-case">
        {items.map((k) => <div key={k.testid} className="bg-white"><KpiCard {...k} icon={k.icon === Receipt ? 'alert' : k.icon} /></div>)}
      </div>
    </div>
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

function PayBanner({ me, openInvoices, stripeOn, onPayMany }) {
  const [sel, setSel] = useState(() => new Set(openInvoices.map((i) => i.id)));
  const key = openInvoices.map((i) => i.id).join(',');
  useEffect(() => { setSel(new Set(openInvoices.map((i) => i.id))); }, [key]);
  if (openInvoices.length === 0) {
    return (
      <div className={`${CARD} px-5 py-4 flex items-center gap-3`} data-testid="saas-all-paid">
        <span className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-500 flex items-center justify-center shrink-0"><CheckCircle2 className="w-5 h-5" /></span>
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
        {stripeOn ? (
          <div className={chosen.length ? '' : 'opacity-40 pointer-events-none'}>
            <PayButtons onPay={(_, m) => onPayMany(chosen.map((i) => i.id), m)} />
          </div>
        ) : <p className="text-xs text-slate-500">Betaal via het tabblad Bankoverschrijving.</p>}
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

function InvoicesPanel({ invoices, stripeOn, onPay }) {
  if (invoices.length === 0) return <p className="p-10 text-sm text-slate-400 text-center">Nog geen facturen.</p>;
  return (
    <div data-testid="my-invoices-list">
      <div className="hidden md:grid grid-cols-[1.4fr_1fr_1fr_0.9fr_auto] gap-4 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-orange-100">
        <span>Periode</span><span>Pakket</span><span className="text-right">Bedrag</span><span>Status</span><span className="w-[190px] text-right">Actie</span>
      </div>
      <div className="divide-y divide-orange-50">
        {invoices.map((inv) => {
          const paid = inv.status === 'paid';
          const open = isOpen(inv);
          return (
            <div key={inv.id} data-testid={`my-invoice-${inv.id}`}
              className="px-5 py-3.5 grid grid-cols-[1fr_auto] md:grid-cols-[1.4fr_1fr_1fr_0.9fr_auto] gap-x-4 gap-y-1 items-center hover:bg-orange-50/40 transition-colors">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}</p>
                <p className="text-[11px] text-slate-400 font-mono">#{(inv.invoice_number || inv.id.slice(0, 8)).toUpperCase()}</p>
              </div>
              <p className="hidden md:block text-sm text-slate-600 capitalize">{inv.plan}</p>
              <p className="text-sm font-black text-slate-900 text-right tabular-nums">{fmt(inv.amount, inv.currency)}</p>
              <div className="md:block">
                <StatusPill tone={paid ? 'green' : open ? 'orange' : 'slate'}>{paid ? 'Betaald' : open ? 'Open' : 'Vervallen'}</StatusPill>
              </div>
              <div className="md:w-[190px] flex md:justify-end justify-end">
                {stripeOn && open ? <PayButtons invoiceId={inv.id} onPay={onPay} size="sm" />
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
  if (payments.length === 0) return <p className="p-10 text-sm text-slate-400 text-center">Nog geen betalingen.</p>;
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
      <p className="text-2xl font-black text-slate-900 mt-4 tracking-tight">{fmt(plan.amount, plan.currency)}<span className="text-xs font-semibold text-slate-400 ml-1">/maand</span></p>
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
  if (!invoice) return <p className="text-xs text-slate-400">Wacht op een nieuwe factuur om bewijs te kunnen uploaden.</p>;

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { onErr('Bestand groter dan 5 MB'); return; }
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('invoice_id', invoice.id);
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
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">Wij controleren automatisch bedrag, datum en omschrijving. Bij een match wordt uw abonnement direct geactiveerd.</p>
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
            Betaling automatisch goedgekeurd. Uw abonnement is direct geactiveerd!
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

function BankPanel({ details, invoice, company, onSuccess, onErr }) {
  const [copied, setCopied] = useState('');
  const refText = `ABONNEMENT — ${company} — ${invoice ? new Date(invoice.created_at).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }) : 'huidige maand'}`;
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
        {invoice && <KV label="Bedrag" value={fmt(invoice.amount, invoice.currency)} mono />}
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
  const [me, setMe] = useState(null);
  const [plans, setPlans] = useState([]);
  const [bank, setBank] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [stripeOn, setStripeOn] = useState(false);
  const [tab, setTab] = useState('invoices');
  const [autopay, setAutopay] = useState(null);
  const [apBusy, setApBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    api.get('/saas-stripe/public-config').then(({ data }) => setStripeOn(!!data?.enabled)).catch(() => setStripeOn(false));
  }, []);

  const goPay = (invoiceId, method) => {
    const back = encodeURIComponent(location.pathname + location.hash);
    navigate(`/saas/checkout/${invoiceId || 'open'}?method=${method}&back=${back}`);
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
    api.get('/billing/me/autopay').then(({ data }) => setAutopay(data)).catch(() => {});
    try {
      const [m, p, b, inv, pay] = await Promise.all([
        api.get('/billing/me'), api.get('/billing/me/plans'), api.get('/billing/bank-details'),
        api.get('/billing/me/invoices'), api.get('/billing/me/payments'),
      ]);
      setMe(m.data); setPlans(p.data); setBank(b.data); setInvoices(inv.data); setPayments(pay.data);
    } catch (e) { setErr(formatError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const changePlan = async (plan) => {
    const word = plan.amount > (me?.monthly_amount || 0) ? 'opwaarderen' : 'downgraden';
    if (!window.confirm(`Pakket ${word} naar ${plan.name} (${fmt(plan.amount, plan.currency)}/maand)?`)) return;
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
  const openTotal = openInvoices.reduce((s, i) => s + Number(i.amount || 0), 0);
  const showBank = !!bank && (me.currency || 'SRD') === 'SRD';

  return (
    <div className="space-y-4" data-testid="mijn-abonnement">
      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm" data-testid="my-sub-error">{err}</div>}
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-sm" data-testid="my-sub-msg">{msg}</div>}

      <KpiStrip me={me} openInvoices={openInvoices} openTotal={openTotal} lastPayment={payments[0]} />
      <PayBanner me={me} openInvoices={sortedOpen} stripeOn={stripeOn} onPayMany={payMany} />
      <AutopayCard autopay={autopay} stripeOn={stripeOn} hasOpen={sortedOpen.length > 0} busy={apBusy}
        onToggle={(v) => apCall(() => api.put('/billing/me/autopay', { enabled: v }))}
        onRemove={() => { if (window.confirm('Opgeslagen kaart verwijderen en automatisch betalen uitzetten?')) apCall(() => api.delete('/billing/me/autopay')); }}
        onSetup={() => payMany(sortedOpen.map((i) => i.id), 'card', true)} />

      <div className={`${CARD} px-2 sm:px-3 py-2 flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar [&>button]:whitespace-nowrap [&>button]:shrink-0`} data-testid="my-sub-tabs">
        <Tab v="invoices" tab={tab} setTab={setTab} label={`Facturen (${invoices.length})`} dot={openInvoices.length ? 'red' : undefined} testid="my-sub-tab-invoices" />
        <Tab v="payments" tab={tab} setTab={setTab} label={`Betalingen (${payments.length})`} dot="green" testid="my-sub-tab-payments" />
        <Tab v="plans" tab={tab} setTab={setTab} label="Pakket wijzigen" testid="my-sub-tab-plans" />
        {showBank && <Tab v="bank" tab={tab} setTab={setTab} label="Bankoverschrijving" testid="my-sub-tab-bank" />}
      </div>

      <div className={`${CARD} overflow-hidden`} data-testid={`my-sub-panel-${tab}`}>
        {tab === 'invoices' && <InvoicesPanel invoices={invoices} stripeOn={stripeOn} onPay={goPay} />}
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
          <BankPanel details={bank} invoice={oldestOpen} company={me.company_name || 'UW BEDRIJF'}
            onSuccess={() => { setMsg('Betaling automatisch goedgekeurd — abonnement is geactiveerd!'); load(); }} onErr={setErr} />
        )}
      </div>

      {(me.status === 'trial' || me.status === 'active') && (
        <div className={`${CARD} px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3`}>
          <span className="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5" /></span>
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
