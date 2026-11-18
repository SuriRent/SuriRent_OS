import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BankTransferDetails } from '../../components/KioskBankTransferModal';
import { api } from '../../lib/api';

export default function KioskBankDetailsPage() {
  const { hash } = useLocation();
  const token = hash.slice(1);
  const valid = /^[A-Za-z0-9_-]{32}$/.test(token);
  const [result, setResult] = useState(null);

  useEffect(() => {
    window.__hidePwaSplash?.();
    if (!valid) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    api.post('/public/kiosk-bank-details', { token }, { signal }).then(({ data }) => {
      if (!signal.aborted) setResult({ token, data });
    }).catch((err) => {
      if (!signal.aborted) setResult({
        token,
        error: err.response?.status === 404 ? 'Deze link is verlopen of ongeldig. Scan een nieuwe QR-code bij de kiosk.'
          : 'De bankgegevens konden niet worden opgehaald. Probeer het opnieuw.',
      });
    });
    return () => controller.abort();
  }, [token, valid]);

  const current = result?.token === token ? result : null;
  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Bankoverschrijving</h1>
        {!valid ? <p role="alert">Deze link is ongeldig. Scan een nieuwe QR-code bij de kiosk.</p>
          : current?.error ? <p role="alert">{current.error}</p>
          : current?.data ? (
            <>
              <p className="text-sm text-slate-600">Gebruik deze gegevens in je bank-app. Deze pagina voert zelf geen betaling uit.</p>
              <BankTransferDetails data={current.data} amount={current.data.amount} currency={current.data.currency} description={current.data.description} />
            </>
          ) : <p role="status">Bankgegevens laden…</p>}
      </div>
    </main>
  );
}
