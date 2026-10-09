/**
 * SaaS Stripe Checkout — custom pagina in SuriRent huisstijl (oranje+wit).
 * GEEN Stripe hosted checkout; we gebruiken Stripe Elements inline voor
 * kaartnummer / vervaldatum / CVV. PaymentIntent komt van de backend.
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, CheckCircle, AlertCircle, Lock, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';

let stripePromise;
const getStripe = (pk) => {
  if (!stripePromise && pk) stripePromise = loadStripe(pk);
  return stripePromise;
};

function CheckoutForm({ intent, onDone }) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true); setErr('');
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (error) {
      setErr(error.message || 'Betaling mislukt — probeer het opnieuw.');
      setPaying(false);
      return;
    }
    // Succesvol zonder redirect — poll backend tot webhook ‘paid’ zet
    for (let i = 0; i < 20; i++) {
      try {
        const { data } = await api.get(`/saas-stripe/intent-status/${intent.payment_intent_id}`);
        if (data.status === 'paid') { onDone(); return; }
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    setErr('Betaling verwerkt maar bevestiging duurt langer dan verwacht. Controleer de factuurstatus in een paar seconden.');
    setPaying(false);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <PaymentElement options={{
        layout: 'tabs',
        defaultValues: { billingDetails: { address: { country: 'NL' } } },
      }} />
      {err && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700" data-testid="checkout-err">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {err}
        </div>
      )}
      <button type="submit" disabled={!stripe || paying} data-testid="checkout-pay-btn"
        className="w-full h-14 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] disabled:bg-slate-300 text-white font-black text-base inline-flex items-center justify-center gap-2 shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)] active:scale-[0.98] transition">
        {paying
          ? (<><Loader2 className="w-5 h-5 animate-spin" /> Betaling verwerken…</>)
          : (<><Lock className="w-5 h-5" /> Betaal €{(intent.amount_eur_cents / 100).toFixed(2)}</>)}
      </button>
      <p className="text-xs text-slate-400 text-center">Veilige betaling via Stripe · Je kaartgegevens worden nooit op onze servers opgeslagen.</p>
    </form>
  );
}

export default function SaaSStripeCheckout() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [intent, setIntent] = useState(null);
  const [stripeKey, setStripeKey] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.post('/saas-stripe/create-intent', { invoice_id: invoiceId });
        setIntent(data);
        setStripeKey(data.publishable_key);
      } catch (e) {
        setErr(e?.response?.data?.detail || 'Kon betaling niet starten.');
      }
    })();
  }, [invoiceId]);

  if (done) {
    return (
      <div className="min-h-screen bg-[#FF5C00] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-11 h-11" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Betaling gelukt!</h1>
          <p className="text-slate-600 mb-6">Je abonnement is direct geactiveerd. We sturen zo meteen een bevestigingsmail.</p>
          <button onClick={() => navigate('/saas/overzicht')} data-testid="checkout-done-btn"
            className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition">
            Terug naar overzicht
          </button>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="min-h-screen bg-[#FF5C00] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center shadow-2xl">
          <AlertCircle className="w-14 h-14 text-red-500 mx-auto mb-3" />
          <h1 className="text-xl font-black text-slate-900 mb-2">Oeps…</h1>
          <p className="text-slate-600 mb-5">{err}</p>
          <button onClick={() => navigate(-1)} className="w-full h-12 rounded-xl bg-slate-900 text-white font-bold">Terug</button>
        </div>
      </div>
    );
  }

  if (!intent || !stripeKey) {
    return (
      <div className="min-h-screen bg-[#FF5C00] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FF5C00] p-4 sm:p-6" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
      <div className="max-w-xl mx-auto">
        <button onClick={() => navigate(-1)} data-testid="checkout-back"
          className="inline-flex items-center gap-2 text-white font-bold bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2 mb-4 active:scale-95 transition">
          <ArrowLeft className="w-4 h-4" /> Terug
        </button>
        <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-2xl">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-1 tracking-tight">Afrekenen</h1>
          <p className="text-sm text-slate-500 mb-6">Veilige betaling via Stripe</p>

          {/* Order samenvatting */}
          <div className="bg-slate-50 rounded-2xl p-4 mb-6">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Factuur</p>
            <div className="row-label-value">
              <span className="font-bold text-slate-700">#{intent.invoice.invoice_number || intent.invoice.id.slice(0, 8)}</span>
              <span className="font-bold text-slate-900">{intent.invoice.currency} {Number(intent.invoice.amount).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="row-label-value mt-2 pt-2 border-t border-slate-200">
              <span className="text-sm text-slate-500">Afrekening in EUR</span>
              <span className="text-xl font-black text-[#FF5C00]">€{(intent.amount_eur_cents / 100).toFixed(2)}</span>
            </div>
          </div>

          <Elements stripe={getStripe(stripeKey)} options={{
            clientSecret: intent.client_secret,
            appearance: {
              theme: 'flat',
              variables: {
                colorPrimary: '#FF5C00',
                colorBackground: '#FFFFFF',
                colorText: '#0F172A',
                colorDanger: '#EF4444',
                fontFamily: 'Outfit, system-ui, sans-serif',
                borderRadius: '12px',
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
