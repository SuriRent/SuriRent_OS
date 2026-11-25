import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fmtMoney, formatError } from '../lib/api';
import SmsCheckout from './SmsCheckout';

export default function SmsPaymentPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.__hidePwaSplash?.();
    setData(null);
    setError('');
    if (token === 'return') return () => { active = false; };
    api.get('/public/sms-payment', { headers: { 'X-Sms-Payment-Token': token } })
      .then(({ data: result }) => { if (active) setData(result); })
      .catch((e) => { if (active) setError(formatError(e, 'De betaallink kon niet worden geopend.')); });
    return () => { active = false; };
  }, [token]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-xl rounded-3xl bg-white p-5 shadow-sm sm:p-8" data-testid="sms-payment-page">
        <h1 className="text-2xl font-black text-slate-900">Betaling</h1>
        {token === 'return' && <div className="mt-4"><SmsCheckout isReturn /></div>}
        {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
        {token !== 'return' && !error && !data && <p className="mt-4 text-slate-500">Laden…</p>}
        {data && (
          <div className="mt-4 space-y-5">
            <p className="font-bold text-slate-800">{data.company.name}</p>
            <section>
              <h2 className="font-bold text-slate-900">Openstaande posten uit deze herinnering</h2>
              {!data.items.length && <p className="mt-2 text-sm text-slate-500">Er zijn geen openstaande posten meer.</p>}
              <div className="mt-2 space-y-2">
                {data.items.map((item) => (
                  <div key={item.kind === 'invoice' ? item.id : `${item.plan_id}-${item.sequence}`}
                    className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-50 p-3">
                    <span>{item.kind === 'invoice' ? `Factuur ${item.reference}` : `Regeling, termijn ${item.sequence}`}</span>
                    <strong>{fmtMoney(item.amount, item.currency)}</strong>
                  </div>
                ))}
              </div>
            </section>
            {data.online_methods.length > 0 && (
              <section>
                <h2 className="font-bold text-slate-900">Online betaalmethoden</h2>
                <p className="mt-1 text-sm text-slate-600">{data.online_methods.map((method) => method.label).join(', ')}</p>
                {!data.online_payment_available && <p className="mt-1 text-sm text-amber-700">Online betalen via deze pagina is nog niet beschikbaar.</p>}
              </section>
            )}
            {data.online_payment_available && (
              <SmsCheckout token={token} items={data.items} methods={data.online_methods} />
            )}
            {data.bank_accounts.length > 0 && (
              <section>
                <h2 className="font-bold text-slate-900">Bankoverschrijving</h2>
                {data.bank_accounts.map((bank) => <p className="mt-1 text-sm text-slate-600" key={bank.country}>{bank.country}: {bank.account}</p>)}
                <p className="mt-1 text-xs text-slate-500">Een bankoverschrijving wordt apart gecontroleerd.</p>
              </section>
            )}
            <section>
              <h2 className="font-bold text-slate-900">Betalen op locatie</h2>
              <p className="mt-1 text-sm text-slate-600">{data.company.address || 'Neem contact op met uw verhuurder voor de betaalinstructies.'}</p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
