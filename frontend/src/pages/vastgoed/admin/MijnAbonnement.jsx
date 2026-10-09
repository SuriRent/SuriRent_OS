import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle, AlertCircle, ArrowUp, ArrowDown, Loader2, Landmark, Banknote, Copy, Check,
  Upload, FileCheck2, ScanLine, CreditCard, CalendarClock, Receipt, Sparkles, ShieldAlert, Wallet,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, formatError } from '../../../lib/api';
import { useAutoRefresh } from '../../../lib/auto-refresh';

const fmt = (n, c = 'SRD') => {
  const cur = (c || 'SRD').toUpperCase();
  if (cur === 'EUR') {
    return `€${Number(n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${cur} ${Number(n || 0).toLocaleString('nl-NL')}`;
};
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const isOpen = (i) => !['paid', 'superseded', 'cancelled', 'void'].includes(i.status);
const METHOD_LABEL = { creditcard: 'Creditcard', ideal: 'iDEAL', bank: 'Bank', stripe: 'Stripe', contant: 'Contant' };

const STATUS = {
  trial:     { label: 'Proefperiode', hero: 'bg-gradient-to-br from-[#FF7A1A] via-[#FF5C00] to-[#C74600]', pill: 'bg-white/20 text-white', dot: 'bg-white' },
  active:    { label: 'Actief',       hero: 'bg-slate-900', pill: 'bg-emerald-400/15 text-emerald-300', dot: 'bg-emerald-400' },
  expired:   { label: 'Verlopen',     hero: 'bg-gradient-to-br from-slate-900 to-rose-950', pill: 'bg-rose-400/15 text-rose-300', dot: 'bg-rose-400' },
  cancelled: { label: 'Opgezegd',     hero: 'bg-slate-700', pill: 'bg-white/10 text-slate-200', dot: 'bg-slate-300' },
};

function Stat({ label, value, testid }) {
  return (
    <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-2.5 sm:px-4 py-3 min-w-0" data-testid={testid}>
      <p className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider sm:tracking-widest text-white/50 truncate">{label}</p>
      <p className="text-xs sm:text-base font-extrabold text-white mt-0.5 truncate">{value}</p>
    </div>
  );
}

function StatusHero({ me, openTotal, lastPayment }) {
  const st = STATUS[me.status] || STATUS.active;
  const sub = {
    trial: <>Uw proefperiode eindigt op <strong>{fmtDate(me.trial_ends_at)}</strong>. Rond de eerste betaling af om door te gaan.</>,
    expired: <>Uw abonnement is verlopen. Betaal de openstaande factuur om direct weer actief te worden.</>,
    active: <>Volgende vernieuwing op <strong>{fmtDate(me.renews_at)}</strong>. U ontvangt vooraf een herinnering.</>,
    cancelled: <>Uw abonnement is opgezegd. Uw gegevens blijven 90 dagen bewaard.</>,
  }[me.status];
  return (
    <section className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-slate-900/15 ${st.hero} sub-rise`}
      data-testid="my-sub-status">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 w-72 h-72 rounded-full bg-[#FF5C00]/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest ${st.pill}`}
            data-testid="my-sub-status-badge">
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot} animate-pulse`} /> {st.label}
          </span>
          {me.status === 'trial' && me.days_left != null && (
            <div className="rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 px-4 py-2 text-right" data-testid="my-sub-days-left">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">Nog over</p>
              <p className="text-2xl font-black leading-none mt-0.5">{me.days_left} <span className="text-sm font-bold">{me.days_left === 1 ? 'dag' : 'dagen'}</span></p>
            </div>
          )}
        </div>
        <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Uw pakket</p>
        <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-none mt-1" data-testid="my-sub-plan-name">{me.plan?.name}</h2>
        <p className="mt-3 text-lg font-bold text-white/90">
          {fmt(me.monthly_amount, me.currency)} <span className="text-sm font-medium text-white/50">/ maand</span>
        </p>
        {sub && <p className="mt-3 text-sm text-white/75 max-w-lg leading-relaxed">{sub}</p>}
        <div className="mt-6 grid grid-cols-3 gap-2">
          <Stat label={me.status === 'trial' ? 'Proef eindigt' : 'Vernieuwing'} value={fmtDate(me.status === 'trial' ? me.trial_ends_at : me.renews_at)} testid="my-sub-stat-renew" />
          <Stat label="Openstaand" value={openTotal > 0 ? fmt(openTotal, me.currency) : 'Niets'} testid="my-sub-stat-open" />
          <Stat label="Betaald op" value={lastPayment ? fmtDate(lastPayment.paid_at) : 'Nog geen'} testid="my-sub-stat-last" />
        </div>
      </div>
    </section>
  );
}

function PayHub({ invoice, stripeOn, onPay, openCount }) {
  if (!invoice) {
    return (
      <section className="rounded-3xl bg-white border border-slate-200 p-6 flex flex-col items-start justify-center gap-3 h-full sub-rise sub-d1" data-testid="saas-all-paid">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><CheckCircle className="w-6 h-6" /></div>
        <h3 className="text-lg font-extrabold text-slate-900">Alles is betaald</h3>
        <p className="text-sm text-slate-500">Er staan geen facturen open. Nieuwe facturen verschijnen hier automatisch.</p>
      </section>
    );
  }
  return (
    <section className="rounded-3xl bg-white border-2 border-orange-500/25 hover:border-orange-500/50 transition-colors p-6 flex flex-col h-full shadow-lg shadow-orange-500/5 sub-rise sub-d1"
      data-testid="saas-online-pay-box">
      <div className="flex items-center gap-2">
        <span className="w-9 h-9 rounded-xl bg-orange-50 text-[#FF5C00] flex items-center justify-center"><Wallet className="w-4 h-4" /></span>
        <h3 className="font-extrabold text-slate-900">Nu betalen</h3>
        {openCount > 1 && <span className="ml-auto text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{openCount} open</span>}
      </div>
      <div className="mt-5 rounded-2xl bg-slate-50 p-4">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Oudste openstaande factuur</p>
        <p className="text-3xl font-black text-slate-900 tracking-tight mt-1" data-testid="saas-pay-amount">{fmt(invoice.amount, invoice.currency)}</p>
        <p className="text-xs text-slate-500 mt-1">{invoice.plan} · {fmtDate(invoice.period_start)} → {fmtDate(invoice.period_end)}</p>
      </div>
      {stripeOn ? (
        <div className="mt-auto pt-5 space-y-2.5">
          <button onClick={() => onPay(invoice.id, 'card')} data-testid="saas-pay-card-btn"
            className="w-full h-12 rounded-2xl bg-[#FF5C00] hover:bg-[#E65300] text-white font-extrabold flex items-center justify-center gap-2 shadow-md shadow-orange-500/25 active:scale-[0.98] transition-transform">
            <CreditCard className="w-4 h-4" /> Betaal met Creditcard
          </button>
          <button onClick={() => onPay(invoice.id, 'ideal')} data-testid="saas-pay-ideal-btn"
            className="w-full h-12 rounded-2xl bg-[#CC0066] hover:bg-[#B0005A] text-white font-extrabold flex items-center justify-center gap-2 shadow-md shadow-pink-600/20 active:scale-[0.98] transition-transform">
            <Landmark className="w-4 h-4" /> Betaal met iDEAL
          </button>
          <p className="text-[11px] text-slate-400 text-center">Direct geactiveerd · Veilig via Stripe</p>
        </div>
      ) : (
        <p className="mt-auto pt-5 text-xs text-slate-500">Betaal via bankoverschrijving hieronder.</p>
      )}
    </section>
  );
}

function BankProofUploader({ invoice, onSuccess, onErr }) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  if (!invoice) {
    return <p className="text-[11px] text-slate-400">Wacht op een nieuwe factuur om bewijs te kunnen uploaden.</p>;
  }

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
    } catch (err) {
      onErr(formatError(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl bg-white border border-slate-200 hover:border-orange-300 transition-colors p-4 h-full flex flex-col" data-testid="saas-bank-proof-uploader">
      <div className="flex items-center gap-2 mb-2">
        <ScanLine className="w-4 h-4 text-orange-600" />
        <h5 className="font-extrabold text-sm text-slate-900">Al overgemaakt? Upload uw bewijs</h5>
      </div>
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        Screenshot of PDF van de overschrijving. Wij controleren automatisch bedrag, datum en omschrijving —
        bij een match wordt uw abonnement direct geactiveerd.
      </p>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={onFile} className="hidden" data-testid="saas-bank-proof-input" />
      {!result && (
        <button onClick={() => fileInput.current?.click()} disabled={busy} data-testid="saas-bank-proof-upload-btn"
          className="mt-auto w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 hover:border-[#FF5C00] hover:bg-orange-50/50 text-slate-600 hover:text-[#FF5C00] font-extrabold flex flex-col items-center justify-center gap-1.5 disabled:opacity-50 transition-colors">
          {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Scannen…</> : <><Upload className="w-5 h-5" /> Upload betaalbewijs<span className="text-[10px] font-semibold text-slate-400">JPG, PNG, WEBP of PDF · max 5 MB</span></>}
        </button>
      )}
      {result?.status === 'paid' && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-start gap-2" data-testid="saas-bank-proof-result-paid">
          <FileCheck2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-900 font-bold leading-snug">
            Betaling automatisch goedgekeurd. Uw abonnement is direct geactiveerd!
            <p className="font-normal text-emerald-700 mt-1">
              Herkend: {result.ocr?.currency || ''} {result.ocr?.amount?.toFixed(2) || '?'}
              {result.ocr?.date_iso && ` · ${result.ocr.date_iso}`}
              {result.ocr?.payer_name && ` · ${result.ocr.payer_name}`}
            </p>
          </div>
        </div>
      )}
      {result?.status === 'pending_approval' && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2" data-testid="saas-bank-proof-result-pending">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-snug">
            <p className="font-bold">Wacht op handmatige goedkeuring.</p>
            <ul className="font-normal text-amber-800 mt-1 ml-4 list-disc">
              {(result.mismatch_reasons || []).slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <p className="font-normal text-amber-700 mt-2">Een medewerker controleert binnenkort uw afschrift.</p>
          </div>
        </div>
      )}
      {result && (
        <button onClick={() => setResult(null)} className="mt-2 text-xs text-slate-500 hover:text-slate-700 font-medium self-start"
          data-testid="saas-bank-proof-retry">Opnieuw uploaden</button>
      )}
    </div>
  );
}

function KV({ label, value, mono, onCopy, copied, wrap }) {
  return (
    <div className="row-label-value items-center py-2 border-b border-slate-200/70 last:border-0">
      <span className="text-slate-500 text-sm">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className={`font-bold text-slate-900 text-sm ${wrap ? 'break-words whitespace-normal text-right' : 'truncate'} ${mono ? 'font-mono' : ''}`}>{value}</span>
        {onCopy && (
          <button onClick={onCopy} title="Kopiëren"
            className="p-1.5 rounded-lg text-slate-400 hover:text-orange-500 hover:bg-white transition-colors shrink-0">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function BankBox({ details, invoice, company, onSuccess, onErr }) {
  const [copied, setCopied] = useState('');
  const refText = `ABONNEMENT — ${company} — ${invoice ? new Date(invoice.created_at).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }) : 'huidige maand'}`;
  const copy = (label, value) => {
    navigator.clipboard.writeText(value || '');
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  };
  return (
    <section className="rounded-3xl bg-slate-50/80 border border-slate-200/80 p-4 sm:p-6 sub-rise sub-d2 min-w-0 overflow-hidden" data-testid="saas-bank-box">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center"><Landmark className="w-4 h-4" /></span>
        <div>
          <h3 className="font-extrabold text-slate-900 leading-tight">Bankoverschrijving</h3>
          <p className="text-[11px] text-slate-500">Liever zelf overmaken? Gebruik onderstaande gegevens.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 [&>*]:min-w-0">
        <div className="rounded-2xl bg-white/70 border border-slate-200/70 px-4 py-1">
          <KV label="Bank" value={details.bank_name} />
          <KV label="Tenaamstelling" value={details.account_name} onCopy={() => copy('account_name', details.account_name)} copied={copied === 'account_name'} />
          <KV label="Rekeningnummer" value={details.account_number} mono onCopy={() => copy('account_number', details.account_number)} copied={copied === 'account_number'} />
          {details.swift && <KV label="SWIFT" value={details.swift} mono onCopy={() => copy('swift', details.swift)} copied={copied === 'swift'} />}
          {invoice && <KV label="Bedrag" value={fmt(invoice.amount, invoice.currency)} mono />}
          <KV label="Omschrijving" value={refText} mono wrap onCopy={() => copy('ref', refText)} copied={copied === 'ref'} />
        </div>
        <BankProofUploader invoice={invoice} onSuccess={onSuccess} onErr={onErr} />
      </div>
      {(details.whatsapp || details.support_email) && (
        <p className="text-[11px] text-slate-500 mt-4">
          Vragen? {details.whatsapp && <>WhatsApp <a href={`https://wa.me/${(details.whatsapp || '').replace(/\D/g, '')}`} className="text-orange-600 font-bold">{details.whatsapp}</a> · </>}
          {details.support_email && <>E-mail <a href={`mailto:${details.support_email}`} className="text-orange-600 font-bold">{details.support_email}</a></>}
        </p>
      )}
    </section>
  );
}

function PlanCard({ plan, currentPlanId, onSelect, busy }) {
  const isCurrent = plan.id === currentPlanId;
  return (
    <div className={`relative rounded-3xl p-6 flex flex-col transition-[box-shadow,border-color,transform] duration-300 ${
      isCurrent ? 'border-2 border-[#FF5C00] bg-gradient-to-b from-orange-50/80 via-white to-white shadow-xl shadow-orange-500/10'
        : 'border border-slate-200 bg-white hover:border-orange-300 hover:shadow-lg hover:-translate-y-0.5'}`}
      data-testid={`plan-card-${plan.id}`}>
      {isCurrent && (
        <span className="absolute -top-3 left-6 px-3 py-1 rounded-full bg-[#FF5C00] text-white text-[10px] font-extrabold uppercase tracking-widest inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> Huidig pakket
        </span>
      )}
      <h3 className="text-xl font-extrabold text-slate-900">{plan.name}</h3>
      <p className="text-sm text-slate-500 mt-0.5">{plan.description}</p>
      <p className="text-3xl font-black text-slate-900 mt-4 tracking-tight">
        {fmt(plan.amount, plan.currency)}<span className="text-xs font-medium text-slate-400 ml-1">/maand</span>
      </p>
      <ul className="mt-4 space-y-1.5 flex-1">
        {(plan.features || []).map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{f}
          </li>
        ))}
      </ul>
      {!isCurrent && (
        <button onClick={() => onSelect(plan)} disabled={busy} data-testid={`plan-select-${plan.id}`}
          className="mt-5 w-full h-11 rounded-xl bg-slate-900 hover:bg-[#FF5C00] text-white font-extrabold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : plan.amount > 0 ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
          Kies {plan.name}
        </button>
      )}
    </div>
  );
}

function InvoiceRow({ inv, stripeOn, onPay }) {
  const paid = inv.status === 'paid';
  const open = isOpen(inv);
  return (
    <div className="p-4 sm:p-5 flex items-center gap-3 sm:gap-4 hover:bg-slate-50/60 transition-colors" data-testid={`my-invoice-${inv.id}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${paid ? 'bg-emerald-50 text-emerald-600' : open ? 'bg-orange-50 text-[#FF5C00]' : 'bg-slate-100 text-slate-400'}`}>
        {paid ? <CheckCircle className="w-5 h-5" /> : <Receipt className="w-5 h-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-extrabold text-slate-900 capitalize">{inv.plan}</p>
          <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${
            paid ? 'bg-emerald-50 text-emerald-700' : open ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
            {paid ? 'Betaald' : open ? 'Open' : 'Vervallen'}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">{fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}</p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        <p className="font-extrabold text-slate-900 tabular-nums">{fmt(inv.amount, inv.currency)}</p>
        {stripeOn && open && (
          <div className="flex gap-1.5">
            <button onClick={() => onPay(inv.id, 'card')} data-testid={`my-invoice-card-${inv.id}`}
              className="text-[11px] font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 px-2 py-1 rounded-lg inline-flex items-center gap-1 transition-colors">
              <CreditCard className="w-3 h-3" /> Creditcard
            </button>
            <button onClick={() => onPay(inv.id, 'ideal')} data-testid={`my-invoice-ideal-${inv.id}`}
              className="text-[11px] font-bold text-[#CC0066] bg-pink-50 hover:bg-pink-100 px-2 py-1 rounded-lg inline-flex items-center gap-1 transition-colors">
              <Landmark className="w-3 h-3" /> iDEAL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, children, aside }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-[#FF5C00]" />
      <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">{children}</h3>
      {aside && <span className="ml-auto text-xs text-slate-400 font-semibold">{aside}</span>}
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
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    api.get('/saas-stripe/public-config').then(({ data }) => setStripeOn(!!data?.enabled)).catch(() => setStripeOn(false));
  }, []);

  const goPay = (invoiceId, method) => {
    const back = encodeURIComponent(location.pathname + location.hash);
    navigate(`/saas/checkout/${invoiceId || 'open'}?method=${method}&back=${back}`);
  };

  const load = useCallback(async () => {
    try {
      const [m, p, b, inv, pay] = await Promise.all([
        api.get('/billing/me'),
        api.get('/billing/me/plans'),
        api.get('/billing/bank-details'),
        api.get('/billing/me/invoices'),
        api.get('/billing/me/payments'),
      ]);
      setMe(m.data); setPlans(p.data); setBank(b.data); setInvoices(inv.data); setPayments(pay.data);
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const changePlan = async (plan) => {
    const isUpgrade = plan.amount > (me?.monthly_amount || 0);
    const word = isUpgrade ? 'opwaarderen' : 'downgraden';
    if (!window.confirm(`Pakket ${word} naar ${plan.name} (${fmt(plan.amount, plan.currency)}/maand)?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const { data } = await api.put('/billing/me/plan', { plan: plan.id });
      setMsg(data.effective === 'immediately'
        ? `Pakket gewijzigd naar ${plan.name}.`
        : `Pakketwijziging gepland — gaat in bij volgende vernieuwing op ${fmtDate(data.renews_at)}.`);
      setTimeout(() => setMsg(''), 5000);
      await load();
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  };

  const cancelSub = async () => {
    if (!window.confirm('Weet u het zeker? Uw abonnement wordt direct opgezegd en u verliest toegang tot uw omgeving.')) return;
    try {
      await api.post('/companies/me/cancel-subscription');
      window.location.reload();
    } catch (e) { setErr(formatError(e, 'Opzeggen mislukt')); }
  };

  if (loading || !me) {
    return <div className="py-16 flex items-center justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;
  }

  const openInvoices = invoices.filter(isOpen);
  const oldestOpen = [...openInvoices].sort((a, b) => String(a.period_start || a.created_at).localeCompare(String(b.period_start || b.created_at)))[0];
  const openTotal = openInvoices.reduce((s, i) => s + Number(i.amount || 0), 0);
  const showBank = bank && (me.currency || 'SRD') === 'SRD' && (me.status === 'trial' || me.status === 'expired' || openInvoices.length > 0);

  return (
    <div className="space-y-6" data-testid="mijn-abonnement">
      <style>{`
        @keyframes subRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .sub-rise { animation: subRise .45s cubic-bezier(.2,.7,.2,1) both; }
        .sub-d1 { animation-delay: .07s; } .sub-d2 { animation-delay: .14s; } .sub-d3 { animation-delay: .21s; }
      `}</style>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm" data-testid="my-sub-error">{err}</div>}
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-sm" data-testid="my-sub-msg">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7"><StatusHero me={me} openTotal={openTotal} lastPayment={payments[0]} /></div>
        <div className="lg:col-span-5"><PayHub invoice={oldestOpen} stripeOn={stripeOn} onPay={goPay} openCount={openInvoices.length} /></div>
      </div>

      {showBank && (
        <BankBox details={bank} invoice={oldestOpen} company={me.company_name || 'UW BEDRIJF'}
          onSuccess={() => { setMsg('Betaling automatisch goedgekeurd — abonnement is geactiveerd!'); load(); }}
          onErr={setErr} />
      )}

      <section className="sub-rise sub-d3">
        <SectionTitle icon={Sparkles} aside="Wijziging bij volgende vernieuwing">Pakket wijzigen</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 pt-2">
          {plans.map((p) => <PlanCard key={p.id} plan={p} currentPlanId={me.plan_id} onSelect={changePlan} busy={busy} />)}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Tijdens de proefperiode treedt de wijziging direct in werking. Bij een actief abonnement geldt de nieuwe prijs vanaf de volgende vernieuwing.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-7">
          <SectionTitle icon={Receipt} aside={`${invoices.length} totaal`}>Facturen</SectionTitle>
          <div className="bg-white rounded-3xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden shadow-sm" data-testid="my-invoices-list">
            {invoices.length === 0
              ? <p className="p-6 text-sm text-slate-400 text-center">Nog geen facturen.</p>
              : invoices.map((inv) => <InvoiceRow key={inv.id} inv={inv} stripeOn={stripeOn} onPay={goPay} />)}
          </div>
        </section>
        <section className="lg:col-span-5">
          <SectionTitle icon={CalendarClock} aside={`${payments.length} totaal`}>Betalingen</SectionTitle>
          <div className="bg-white rounded-3xl border border-slate-200/80 p-2 shadow-sm" data-testid="my-payments-list">
            {payments.length === 0 ? (
              <p className="p-6 text-sm text-slate-400 text-center">Nog geen betalingen.</p>
            ) : (
              <ol className="relative">
                {payments.map((p, i) => (
                  <li key={p.id} className="flex items-start gap-3 p-3" data-testid={`my-payment-${p.id}`}>
                    <div className="relative flex flex-col items-center self-stretch">
                      <span className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Banknote className="w-4 h-4" /></span>
                      {i < payments.length - 1 && <span className="flex-1 w-px bg-slate-200 mt-1" />}
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <div className="row-label-value">
                        <p className="font-extrabold text-slate-900 tabular-nums">{fmt(p.amount, p.currency)}</p>
                        <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{METHOD_LABEL[p.method] || p.method}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{fmtDate(p.paid_at)}{p.reference ? ` · ${p.reference}` : ''}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>

      {(me.status === 'trial' || me.status === 'active') && (
        <section className="rounded-3xl p-6 bg-rose-50/40 border border-rose-200/70 flex flex-col sm:flex-row sm:items-center gap-4">
          <span className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5" /></span>
          <div className="flex-1">
            <h4 className="font-extrabold text-rose-900">Abonnement opzeggen</h4>
            <p className="text-sm text-rose-700 mt-0.5 leading-relaxed">
              Toegang tot de beheeromgeving wordt direct geblokkeerd. Uw data blijft 90 dagen bewaard zodat u kunt heractiveren.
            </p>
          </div>
          <button onClick={cancelSub} data-testid="cancel-subscription-btn"
            className="h-11 px-6 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-extrabold text-sm transition-transform shrink-0">
            Abonnement opzeggen
          </button>
        </section>
      )}
    </div>
  );
}
