/**
 * SaaS Stripe Checkout — eigen pagina in SuriRent huisstijl (oranje+wit).
 * Stripe Elements inline (geen hosted checkout). Ondersteunt Creditcard en
 * iDEAL (?method=card|ideal). `:invoiceId` = 'open' → oudste open factuur.
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, CheckCircle, AlertCircle, Lock, ArrowLeft, CreditCard, Landmark } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const stripeCache = {};
const getStripe = (pk) => {
  if (!stripeCache[pk]) stripeCache[pk] = loadStripe(pk);
  return stripeCache[pk];
};

const METHOD_LABEL = { card: 'Creditcard', ideal: 'iDEAL' };

async function pollPaid(intentId, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const { data } = await api.get(`/saas-stripe/intent-status/${intentId}`);
      if (data.status === 'paid') return 'paid';
      if (data.status === 'failed' || data.status === 'canceled') return data.status;
    } catch { /* opnieuw proberen */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return 'timeout';
}

function CheckoutForm({ intent, onDone }) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true); setErr('');
    const ret = new URL(window.location.href);
    ret.searchParams.set('pi', intent.payment_intent_id);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: ret.toString() },
      redirect: 'if_required',
    });
    if (error) {
      setErr(error.message || 'Betaling mislukt — probeer het opnieuw.');
      setPaying(false);
      return;
    }
    const res = await pollPaid(intent.payment_intent_id);
    if (res === 'paid') { onDone(); return; }
    setErr(res === 'timeout'
      ? 'Betaling verwerkt maar bevestiging duurt langer dan verwacht. Controleer de factuurstatus over enkele seconden.'
      : 'Betaling is niet gelukt — probeer het opnieuw.');
    setPaying(false);
  };

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="checkout-form">
      <PaymentElement options={{ layout: 'tabs', defaultValues: { billingDetails: { address: { country: 'NL' } } } }} />
      {err && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700" data-testid="checkout-err">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {err}
        </div>
      )}
      <button type="submit" disabled={!stripe || paying} data-testid="checkout-pay-btn"
        className="w-full h-14 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] disabled:bg-slate-300 text-white font-black text-base inline-flex items-center justify-center gap-2 shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)] active:scale-[0.98] transition-transform">
        {paying
          ? (<><Loader2 className="w-5 h-5 animate-spin" /> Betaling verwerken…</>)
          : (<><Lock className="w-5 h-5" /> Betaal €{(intent.amount_eur_cents / 100).toFixed(2)} met {METHOD_LABEL[intent.method]}</>)}
      </button>
      <p className="text-xs text-slate-400 text-center">Veilige betaling via Stripe · Uw betaalgegevens worden nooit op onze servers opgeslagen.</p>
    </form>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#FF5C00] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center shadow-2xl">{children}</div>
    </div>
  );
}

export default function SaaSStripeCheckout() {
  const { invoiceId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const method = params.get('method') === 'ideal' ? 'ideal' : 'card';
  const returnedPi = params.get('pi') || params.get('payment_intent');
  const back = params.get('back') || (user?.role === 'superadmin' ? '/admin/saas_invoices' : '/admin/mijn_abonnement');
  const [intent, setIntent] = useState(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [checking, setChecking] = useState(!!returnedPi);

  useEffect(() => {
    if (returnedPi) {
      // Terug van iDEAL/3DS-redirect: status controleren i.p.v. nieuwe betaling
      (async () => {
        const res = await pollPaid(returnedPi, 15);
        setChecking(false);
        if (res === 'paid') setDone(true);
        else setErr(res === 'timeout'
          ? 'We hebben uw betaling nog niet ontvangen. Controleer over een minuut uw factuurstatus.'
          : 'De betaling is geannuleerd of mislukt. U kunt het opnieuw proberen.');
      })();
      return;
    }
    (async () => {
      try {
        const body = { method, ...(invoiceId && invoiceId !== 'open' ? { invoice_id: invoiceId } : {}) };
        const { data } = await api.post('/saas-stripe/create-intent', body);
        setIntent(data);
      } catch (e) {
        setErr(e?.response?.data?.detail || 'Kon betaling niet starten.');
      }
    })();
  }, [invoiceId, method, returnedPi]);

  if (done) {
    return (
      <Shell>
        <div data-testid="checkout-success">
          <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-11 h-11" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Betaling gelukt!</h1>
          <p className="text-slate-600 mb-6">Uw abonnement is direct geactiveerd. U ontvangt een bevestiging per e-mail.</p>
          <button onClick={() => navigate(back)} data-testid="checkout-done-btn"
            className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition-colors">
            Terug naar abonnement
          </button>
        </div>
      </Shell>
    );
  }

  if (err) {
    return (
      <Shell>
        <div data-testid="checkout-error-screen">
          <AlertCircle className="w-14 h-14 text-red-500 mx-auto mb-3" />
          <h1 className="text-xl font-black text-slate-900 mb-2">Oeps…</h1>
          <p className="text-slate-600 mb-5" data-testid="checkout-error-msg">{err}</p>
          <button onClick={() => navigate(back)} data-testid="checkout-error-back"
            className="w-full h-12 rounded-xl bg-slate-900 text-white font-bold">Terug</button>
        </div>
      </Shell>
    );
  }

  if (checking || !intent) {
    return (
      <div className="min-h-screen bg-[#FF5C00] flex flex-col items-center justify-center gap-3" data-testid="checkout-loading">
        <Loader2 className="w-10 h-10 text-white animate-spin" />
        {checking && <p className="text-white font-bold">Betaling controleren…</p>}
      </div>
    );
  }

  const MIcon = intent.method === 'ideal' ? Landmark : CreditCard;
  return (
    <div className="min-h-screen bg-[#FF5C00] p-4 sm:p-6" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
      <div className="max-w-xl mx-auto">
        <button onClick={() => navigate(back)} data-testid="checkout-back"
          className="inline-flex items-center gap-2 text-white font-bold bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2 mb-4 active:scale-95 transition-transform">
          <ArrowLeft className="w-4 h-4" /> Terug
        </button>
        <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-1 tracking-tight">Afrekenen</h1>
              <p className="text-sm text-slate-500 inline-flex items-center gap-1.5" data-testid="checkout-method">
                <MIcon className="w-4 h-4 text-[#FF5C00]" /> {METHOD_LABEL[intent.method]} via Stripe
              </p>
            </div>
            {intent.mode === 'test' && (
              <span className="text-[10px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 px-2 py-1 rounded-lg" data-testid="checkout-test-badge">Testmodus</span>
            )}
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 mb-6" data-testid="checkout-summary">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Factuur</p>
            <div className="row-label-value">
              <span className="font-bold text-slate-700">#{intent.invoice.invoice_number || intent.invoice.id.slice(0, 8).toUpperCase()}{intent.invoice.plan ? ` · ${intent.invoice.plan}` : ''}</span>
              <span className="font-bold text-slate-900">{intent.invoice.currency} {Number(intent.invoice.amount).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="row-label-value mt-2 pt-2 border-t border-slate-200">
              <span className="text-sm text-slate-500">Afrekening in EUR</span>
              <span className="text-xl font-black text-[#FF5C00]" data-testid="checkout-eur-amount">€{(intent.amount_eur_cents / 100).toFixed(2)}</span>
            </div>
          </div>

          <Elements stripe={getStripe(intent.publishable_key)} options={{
            clientSecret: intent.client_secret,
            locale: 'nl',
            appearance: {
              theme: 'flat',
              variables: {
                colorPrimary: '#FF5C00', colorBackground: '#FFFFFF', colorText: '#0F172A',
                colorDanger: '#EF4444', fontFamily: 'Outfit, system-ui, sans-serif', borderRadius: '12px',
              },
            },
          }}>
            <CheckoutForm intent={intent} onDone={() => setDone(true)} />
          </Elements>
        </div>
      </div>
    </div>
  );
}
