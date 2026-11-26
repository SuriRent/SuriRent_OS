import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api, fmtMoney } from '../lib/api';

const StripePayElements = lazy(() => import('../components/StripePayElements')
  .then((module) => ({ default: module.StripePayElements })));
const STORAGE_KEY = 'surirent_sms_checkout';
const tokenPattern = /^[A-Za-z0-9_-]{22}$/;

function readPending() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const saved = JSON.parse(raw);
  if (!saved || !tokenPattern.test(saved.token) || !saved.item || typeof saved.item !== 'object') {
    throw new Error('Ongeldige opgeslagen betaalpoging');
  }
  return saved;
}

function paymentItem(item) {
  return item.kind === 'invoice'
    ? { kind: 'invoice', id: item.id }
    : { kind: 'installment', plan_id: item.plan_id, sequence: item.sequence };
}

function sameItem(left, right) {
  if (!left || left.kind !== right.kind) return false;
  return right.kind === 'invoice'
    ? left.id === right.id
    : left.plan_id === right.plan_id && left.sequence === right.sequence;
}

function mopeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port
        && (url.hostname === 'mope.sr' || url.hostname.endsWith('.mope.sr'))) return url.href;
  } catch {
    return null;
  }
  return null;
}

export default function SmsCheckout({ token, items = [], methods = [], isReturn = false }) {
  const [selectedItem, setSelectedItem] = useState(0);
  const [method, setMethod] = useState(methods[0]?.id || '');
  const [saved, setSaved] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const returning = useRef(false);

  const verify = async (attempt) => {
    if (!attempt?.attempt_id) {
      setMessage('De betaalpoging kon niet worden teruggevonden. Neem contact op met uw verhuurder voordat u opnieuw betaalt.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { data } = await api.post('/public/sms-payment/finish', {
        item: attempt.item, attempt_id: attempt.attempt_id,
      }, { headers: { 'X-Sms-Payment-Token': attempt.token } });
      if (data.status !== 'paid' || typeof data.receipt_number !== 'string' || !data.receipt_number) {
        throw new Error('Ongeldige betaalbevestiging');
      }
      setConfirmed(data);
      setCheckout(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
        setSaved(null);
      } catch {
        setMessage('De betaling is bevestigd, maar de opgeslagen betaalstatus kon niet worden gewist.');
      }
    } catch {
      setMessage('De betaling is nog niet bevestigd. Controleer de status opnieuw of neem contact op met uw verhuurder voordat u opnieuw betaalt.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    try {
      const attempt = readPending();
      if (attempt && (isReturn || attempt.token === token)) {
        setSaved(attempt);
        if (isReturn && !returning.current) {
          returning.current = true;
          verify(attempt);
        } else if (!attempt.attempt_id) {
          setMessage('De betaalpoging kon niet worden teruggevonden. Neem contact op met uw verhuurder voordat u opnieuw betaalt.');
        }
      } else if (isReturn) {
        setMessage('Open de betaallink uit uw sms om de betaalstatus te controleren.');
      }
    } catch {
      setMessage('De betaalstatus kan niet veilig worden opgeslagen of teruggelezen. Neem contact op met uw verhuurder.');
    }
  }, [token, isReturn]);

  const start = async () => {
    if (!items[selectedItem] || !method || busy) return;
    const item = paymentItem(items[selectedItem]);
    const provisional = { token, item };
    setMessage('');
    try {
      const previous = readPending();
      if (previous) {
        setMessage('Er staat al een betaalpoging open in dit browservenster. Controleer die eerst.');
        return;
      }
      if (!tokenPattern.test(token)) throw new Error('Ongeldige betaallink');
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(provisional));
    } catch {
      setMessage('De betaalstatus kan niet veilig worden opgeslagen. Start de betaling niet en neem contact op met uw verhuurder.');
      return;
    }
    setSaved(provisional);
    setBusy(true);
    let storedAttempt = provisional;
    try {
      const { data } = await api.post('/public/sms-payment/start', { item, method }, {
        headers: { 'X-Sms-Payment-Token': token },
      });
      if (typeof data.attempt_id !== 'string' || !data.attempt_id || data.method !== method) {
        throw new Error('Ongeldig betaalverzoek');
      }
      const attempt = { ...provisional, attempt_id: data.attempt_id };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attempt));
      storedAttempt = attempt;
      setSaved(attempt);
      if (!sameItem(data.item, item)
          || !Number.isInteger(data.amount_cents) || data.amount_cents <= 0
          || !['SRD', 'EUR', 'USD'].includes(data.currency)) throw new Error('Ongeldige betaalpost');
      const original = { amount: data.amount_cents / 100, currency: data.currency };
      if (method === 'mope') {
        const url = mopeUrl(data.payment_url);
        if (!url) throw new Error('Ongeldige betaallink van Mopé');
        setCheckout({ method, url, original });
      } else {
        if (typeof data.client_secret !== 'string' || !data.client_secret
            || typeof data.publishable_key !== 'string' || !data.publishable_key
            || !Number.isInteger(data.provider_amount_cents) || data.provider_amount_cents <= 0
            || data.provider_currency !== 'EUR') throw new Error('Ongeldig Stripe-betaalverzoek');
        setCheckout({ method, clientSecret: data.client_secret, publishableKey: data.publishable_key,
          amount: data.provider_amount_cents / 100, original });
      }
    } catch {
      setMessage(storedAttempt.attempt_id
        ? 'Het betaalverzoek kon niet worden bevestigd. Controleer de status of neem contact op met uw verhuurder voordat u opnieuw betaalt.'
        : 'Het betaalverzoek kon niet worden teruggevonden. Neem contact op met uw verhuurder voordat u opnieuw betaalt.');
    } finally {
      setBusy(false);
    }
  };

  if (confirmed) {
    return (
      <section role="status" className="rounded-xl bg-green-50 p-4 text-green-800">
        <h2 className="font-bold">Betaling bevestigd</h2>
        <p>Bonnummer: {confirmed.receipt_number}</p>
        {message && <p>{message}</p>}
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="font-bold text-slate-900">Online betalen</h2>
      {message && <p role="alert" className="text-sm text-amber-700">{message}</p>}
      {!saved && !isReturn && items.length > 0 && methods.length > 0 && (
        <>
          <label className="block text-sm">Kies een post
            <select className="mt-1 w-full rounded-lg border p-2" value={selectedItem}
              onChange={(event) => setSelectedItem(Number(event.target.value))}>
              {items.map((item, index) => (
                <option key={item.kind === 'invoice' ? item.id : `${item.plan_id}-${item.sequence}`} value={index}>
                  {item.kind === 'invoice' ? `Factuur ${item.reference}` : `Regeling, termijn ${item.sequence}`}
                  {' — '}{fmtMoney(item.amount, item.currency)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">Betaalmethode
            <select className="mt-1 w-full rounded-lg border p-2" value={method}
              onChange={(event) => setMethod(event.target.value)}>
              {methods.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || !items.length || !method} onClick={start}
            className="w-full rounded-xl bg-orange-600 p-3 font-bold text-white disabled:bg-slate-300">
            {busy ? 'Betaalverzoek voorbereiden…' : 'Verder met betalen'}
          </button>
        </>
      )}
      {checkout && <p className="text-sm text-slate-600">Voor deze post wordt {fmtMoney(checkout.original.amount, checkout.original.currency)} geboekt.</p>}
      {checkout?.method === 'mope' && (
        <a href={checkout.url} rel="noreferrer" className="block rounded-xl bg-orange-600 p-3 text-center font-bold text-white">
          Open Mopé-betaalpagina
        </a>
      )}
      {checkout && checkout.method !== 'mope' && (
        <Suspense fallback={<p>Betaalformulier laden…</p>}>
          <StripePayElements publishableKey={checkout.publishableKey} clientSecret={checkout.clientSecret}
            amountLabel={fmtMoney(checkout.amount, 'EUR')} returnUrl={`${window.location.origin}/b/return`}
            onPaid={() => { setCheckout(null); verify(saved); }}
            onUncertain={() => { setCheckout(null); verify(saved); }} />
        </Suspense>
      )}
      {saved && (
        <button type="button" disabled={busy || !saved.attempt_id} onClick={() => verify(saved)}
          className="w-full rounded-xl border border-slate-300 p-3 font-bold disabled:text-slate-400">
          {busy ? 'Betaalstatus controleren…' : 'Controleer betaalstatus'}
        </button>
      )}
    </section>
  );
}
