import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, CheckCircle2, Copy, Landmark, Loader2, Upload, AlertCircle } from 'lucide-react';
import { api, formatError } from '../lib/api';
import { useBrandedNavigate } from '../lib/branded-nav';

const isOpen = (invoice) => !['paid', 'superseded', 'cancelled', 'void'].includes(invoice.status);
const money = (amount, currency = 'SRD') =>
  `${currency} ${Number(amount || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value) => value
  ? new Date(value).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
  : '—';

function paymentFor(invoice) {
  const next = (invoice.payment_plans || [])
    .flatMap((plan) => (plan.schedule || []).map((term) => ({ plan, term })))
    .filter(({ term }) => term.status !== 'paid' && Number(term.amount || 0) > Number(term.paid_amount || 0))
    .sort((a, b) => (a.term.due_date || '').localeCompare(b.term.due_date || '') || a.term.seq - b.term.seq)[0];
  const balance = Number(invoice.balance_due ?? (Number(invoice.amount || 0) - Number(invoice.paid_amount || 0)));
  return {
    amount: next
      ? Number(next.term.amount) - Number(next.term.paid_amount || 0)
      : balance,
    installment: next,
  };
}

export default function SaaSBankCheckout() {
  const { invoiceId } = useParams();
  const [params] = useSearchParams();
  const navigate = useBrandedNavigate();
  const fileRef = useRef(null);
  const [data, setData] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState('');

  const backParam = params.get('back');
  const back = backParam && backParam.startsWith('/') && !backParam.startsWith('//')
    ? backParam
    : '/admin/instellingen#abonnement';
  const payment = useMemo(() => invoice ? paymentFor(invoice) : null, [invoice]);
  const reference = invoice
    ? `ABONNEMENT — ${data?.me?.company_name || 'UW BEDRIJF'} — ${invoice.invoice_number || invoice.id.slice(0, 8).toUpperCase()}`
    : '';

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/billing/me'),
      api.get('/billing/me/invoices'),
      api.get('/billing/bank-details'),
    ]).then(async ([me, invoices, bank]) => {
      if (!active) return;
      const open = (invoices.data || []).filter(isOpen);
      let selected = invoiceId === 'open'
        ? open.sort((a, b) => String(a.period_start || a.created_at).localeCompare(String(b.period_start || b.created_at)))[0]
        : open.find((item) => item.id === invoiceId);
      if (!selected && invoiceId === 'open') {
        await api.post('/billing/me/bank-invoice');
        const refreshed = await api.get('/billing/me/invoices');
        selected = (refreshed.data || []).filter(isOpen)
          .sort((a, b) => String(a.period_start || a.created_at).localeCompare(String(b.period_start || b.created_at)))[0];
      }
      if (!active) return;
      if (!selected) {
        setError('Er is geen openstaande factuur gevonden om via bankoverschrijving te betalen.');
      } else if ((selected.currency || me.data.currency || 'SRD').toUpperCase() !== 'SRD') {
        setError('Bankoverschrijving is momenteel alleen beschikbaar voor facturen in SRD.');
      } else {
        setInvoice(selected);
      }
      setData({ me: me.data, bank: bank.data });
    }).catch((e) => {
      if (active) setError(formatError(e, 'Betaalgegevens konden niet worden geladen.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [invoiceId]);

  const copy = async (label, value) => {
    try {
      await navigator.clipboard.writeText(value || '');
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setError('Kopiëren is niet gelukt. Selecteer de tekst en kopieer deze handmatig.');
    }
  };

  const uploadProof = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Het betaalbewijs mag maximaal 5 MB zijn.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('invoice_id', invoice.id);
      const response = await api.post('/billing/me/bank-confirm', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(response.data);
    } catch (e) {
      setError(formatError(e, 'Het betaalbewijs kon niet worden gecontroleerd.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-[#FF5C00] flex items-center justify-center" data-testid="bank-checkout-loading">
      <Loader2 className="w-10 h-10 text-white animate-spin" />
    </div>;
  }

  const bank = data?.bank || {};
  const amount = payment?.amount || 0;
  const method = payment?.installment
    ? `Termijn ${payment.installment.term.seq}/${payment.installment.plan.installments}`
    : 'Openstaand bedrag';

  return (
    <div className="min-h-screen bg-[#FF5C00] p-4 sm:p-6" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
      <main className="max-w-xl mx-auto">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="text-white">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/75">SuriRent</p>
            <h1 className="text-2xl sm:text-3xl font-black mt-1">Bankoverschrijving</h1>
            <p className="text-sm text-white/85 mt-1">Maak het bedrag over en upload daarna uw betaalbewijs.</p>
          </div>
          <button onClick={() => navigate(back)} data-testid="bank-checkout-back"
            className="inline-flex items-center gap-2 text-white font-bold bg-white/15 rounded-xl px-4 py-2 shrink-0">
            <ArrowLeft className="w-4 h-4" /> Terug
          </button>
        </div>

        <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5">
          {error && <div role="alert" data-testid="bank-checkout-error" className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
          </div>}

          {invoice && data && (
            <>
              <section className="rounded-2xl bg-slate-50 p-4" data-testid="bank-checkout-summary">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Factuur</p>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-900">#{invoice.invoice_number || invoice.id.slice(0, 8).toUpperCase()}</p>
                    <p className="text-xs text-slate-500 mt-1">{invoice.plan || data.me.plan?.name} · {method}</p>
                  </div>
                  <p className="text-xl font-black text-[#FF5C00] text-right">{money(amount, invoice.currency)}</p>
                </div>
                <p className="text-xs text-slate-500 mt-2">Factuurperiode {date(invoice.period_start)} – {date(invoice.period_end)}</p>
                {invoice.due_date && <p className="text-xs font-semibold text-orange-700 mt-1">Uiterlijk betalen: {date(invoice.due_date)}</p>}
              </section>

              <section className="rounded-2xl border border-slate-200 p-4" data-testid="bank-checkout-details">
                <h2 className="font-black text-slate-900 flex items-center gap-2 mb-2">
                  <Landmark className="w-4 h-4 text-[#FF5C00]" /> Overmaken naar
                </h2>
                <Detail label="Bank" value={bank.bank_name} />
                <Detail label="Tenaamstelling" value={bank.account_name} onCopy={() => copy('name', bank.account_name)} copied={copied === 'name'} />
                <Detail label="Rekeningnummer" value={bank.account_number} onCopy={() => copy('account', bank.account_number)} copied={copied === 'account'} />
                {bank.swift && <Detail label="SWIFT" value={bank.swift} onCopy={() => copy('swift', bank.swift)} copied={copied === 'swift'} />}
                <Detail label="Bedrag" value={money(amount, invoice.currency)} onCopy={() => copy('amount', String(amount))} copied={copied === 'amount'} />
                <Detail label="Omschrijving" value={reference} onCopy={() => copy('reference', reference)} copied={copied === 'reference'} />
                <p className="text-xs text-slate-500 mt-3">Gebruik de omschrijving precies zoals hierboven. De automatische controle vergelijkt bedrag, valuta, datum en leesbaarheid. Dit is geen rechtstreekse controle bij de bank; onduidelijke bewijzen worden handmatig nagekeken.</p>
              </section>

              {!result && (
                <section className="rounded-2xl border-2 border-dashed border-orange-200 p-4" data-testid="bank-checkout-upload">
                  <h2 className="font-black text-slate-900">Betaalbewijs controleren</h2>
                  <p className="text-xs text-slate-500 mt-1 mb-3">Upload een screenshot, foto of PDF van de uitgevoerde overschrijving. Maximaal 5 MB.</p>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={uploadProof} className="hidden" data-testid="bank-checkout-file" />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || !amount}
                    className="w-full h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                    data-testid="bank-checkout-upload-btn">
                    {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Bewijs controleren…</> : <><Upload className="w-4 h-4" /> Upload betaalbewijs</>}
                  </button>
                </section>
              )}

              {result?.status === 'paid' && (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4" role="status" data-testid="bank-checkout-paid">
                  <p className="font-black text-emerald-800 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Betaalbewijs automatisch goedgekeurd</p>
                  <p className="text-sm text-emerald-700 mt-1">
                    {result.invoice_paid ? 'De factuur is voldaan en uw abonnement is geactiveerd.' : 'De betaling is geboekt; het resterende factuursaldo blijft open.'}
                  </p>
                  <button onClick={() => navigate(back)} className="mt-3 h-10 px-4 rounded-xl bg-emerald-600 text-white font-bold" data-testid="bank-checkout-success-back">
                    Terug naar mijn abonnement
                  </button>
                </div>
              )}
              {result?.status === 'pending_approval' && (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4" role="status" data-testid="bank-checkout-pending">
                  <p className="font-black text-amber-900">Bewijs ontvangen — handmatige controle nodig</p>
                  <p className="text-sm text-amber-800 mt-1">De controle kon niet met voldoende zekerheid bevestigen dat bedrag en transactiegegevens overeenkomen. Het wordt door SuriRent nagekeken; uw abonnement wordt na goedkeuring geactiveerd.</p>
                  {(result.mismatch_reasons || []).length > 0 && <ul className="list-disc ml-5 mt-2 text-xs text-amber-800">{result.mismatch_reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                  <button type="button" onClick={() => setResult(null)} className="mt-3 text-sm font-bold text-amber-900 underline" data-testid="bank-checkout-retry">
                    Upload een duidelijker bewijs
                  </button>
                </div>
              )}
              {(bank.support_email || bank.whatsapp) && <p className="text-center text-xs text-slate-400">
                Hulp nodig? {bank.support_email && <a className="font-bold text-[#FF5C00]" href={`mailto:${bank.support_email}`}>{bank.support_email}</a>}
                {bank.support_email && bank.whatsapp && ' · '}
                {bank.whatsapp && <a className="font-bold text-[#FF5C00]" href={`https://wa.me/${bank.whatsapp.replace(/\D/g, '')}`}>WhatsApp {bank.whatsapp}</a>}
              </p>}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Detail({ label, value, onCopy, copied }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="flex items-start gap-1 min-w-0 text-right">
        <span className="text-sm font-bold text-slate-900 break-all">{value || '—'}</span>
        {onCopy && <button type="button" onClick={onCopy} aria-label={`${label} kopiëren`} className="p-1 text-slate-400 hover:text-[#FF5C00] shrink-0">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>}
      </span>
    </div>
  );
}
