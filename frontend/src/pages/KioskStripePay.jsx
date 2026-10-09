import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { CheckoutBrandHeader } from '../components/CheckoutBrandHeader';
import { StripePayElements } from '../components/StripePayElements';

// Publieke betaalpagina die de huurder opent via de QR-code op de Kiosk.
export default function KioskStripePay() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { const { data: d } = await api.get(`/public/kiosk-pay/${token}`); setData(d); return d; }
    catch (e) { setErr(e?.response?.data?.detail || 'Betaallink niet gevonden.'); return null; }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  const afterPay = async () => {
    for (let i = 0; i < 15; i++) {
      const d = await load();
      if (d?.status === 'paid') return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
  useEffect(() => { if (new URLSearchParams(window.location.search).get('payment_intent')) afterPay(); }, []);

  const eur = data ? `€${(data.amount_eur_cents / 100).toFixed(2)}` : '';
  return (
    <div className="min-h-screen bg-[#FF5C00] p-4 sm:p-6" style={{ paddingTop: 'max(env(safe-area-inset-top), 20px)' }}>
      <div className="max-w-md mx-auto">
        <CheckoutBrandHeader name={data?.company_name} logoUrl={data?.logo_url} testid="kiosk-pay-brand" />
        <div className="bg-white rounded-3xl p-6 shadow-2xl" data-testid="kiosk-pay-card">
          {err && <div className="text-center py-6" data-testid="kiosk-pay-error"><AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-2" /><p className="font-bold text-slate-800">{err}</p></div>}
          {!err && !data && <div className="py-10 flex justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>}
          {data && data.status === 'paid' && (
            <div className="text-center py-6" data-testid="kiosk-pay-success">
              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4"><CheckCircle className="w-11 h-11" /></div>
              <h1 className="text-2xl font-black text-slate-900">Betaling gelukt!</h1>
              <p className="text-slate-500 mt-1">U kunt dit venster sluiten. De kiosk verwerkt uw betaling.</p>
            </div>
          )}
          {data && data.status !== 'paid' && data.client_secret && (
            <>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Huur betalen</h1>
              <p className="text-sm text-slate-500 mb-4">{data.tenant_name}</p>
              <div className="bg-slate-50 rounded-2xl p-4 mb-5">
                <div className="row-label-value"><span className="text-sm text-slate-500">Bedrag</span><span className="font-bold text-slate-900">{data.currency} {Number(data.amount).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}</span></div>
                <div className="row-label-value mt-2 pt-2 border-t border-slate-200"><span className="text-sm text-slate-500">Afrekening in EUR</span><span className="text-xl font-black text-[#FF5C00]" data-testid="kiosk-pay-eur">{eur}</span></div>
              </div>
              <StripePayElements publishableKey={data.publishable_key} clientSecret={data.client_secret} amountLabel={eur}
                returnUrl={window.location.href.split('?')[0]} onPaid={afterPay} />
            </>
          )}
          {data && data.status !== 'paid' && !data.client_secret && (
            <p className="text-center py-6 font-bold text-slate-700" data-testid="kiosk-pay-closed">Deze betaling is niet meer actief.</p>
          )}
        </div>
      </div>
    </div>
  );
}
