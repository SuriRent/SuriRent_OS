import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js/pure';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, Lock, AlertCircle } from 'lucide-react';

const cache = {};
const getStripe = (pk) => { if (!cache[pk]) cache[pk] = loadStripe(pk); return cache[pk]; };

function Form({ amountLabel, returnUrl, onPaid }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setErr('');
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements, confirmParams: { return_url: returnUrl }, redirect: 'if_required',
    });
    if (error) { setErr(error.message || 'Betaling mislukt — probeer opnieuw.'); setBusy(false); return; }
    if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') onPaid?.();
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="stripe-pay-form">
      <PaymentElement options={{ layout: 'tabs' }} />
      {err && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700" data-testid="stripe-pay-err">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {err}
        </div>
      )}
      <button type="submit" disabled={!stripe || busy} data-testid="stripe-pay-btn"
        className="w-full h-14 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] disabled:bg-slate-300 text-white font-black inline-flex items-center justify-center gap-2 shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)] active:scale-[0.98] transition-transform">
        {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Verwerken…</> : <><Lock className="w-5 h-5" /> Betaal {amountLabel}</>}
      </button>
    </form>
  );
}

export function StripePayElements({ publishableKey, clientSecret, amountLabel, returnUrl, onPaid }) {
  return (
    <Elements stripe={getStripe(publishableKey)} options={{
      clientSecret, locale: 'nl',
      appearance: { theme: 'flat', variables: { colorPrimary: '#FF5C00', borderRadius: '12px', fontFamily: 'Outfit, system-ui, sans-serif' } },
    }}>
      <Form amountLabel={amountLabel} returnUrl={returnUrl} onPaid={onPaid} />
    </Elements>
  );
}
