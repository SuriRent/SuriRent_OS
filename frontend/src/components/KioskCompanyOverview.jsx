import { useEffect, useState } from 'react';
import { BarChart3, CircleAlert, Loader2, Wallet, CircleCheck } from 'lucide-react';
import { api, fmtMoney, formatError } from '../lib/api';

const STATS = [
  ['paid', 'Betaald bedrag', 'Ontvangen in de gekozen maand', CircleCheck, 'bg-emerald-100 text-emerald-700'],
  ['outstanding', 'Openstaand bedrag', 'Huidig saldo, inclusief achterstand', Wallet, 'bg-orange-100 text-orange-700'],
  ['overdue', 'Achterstandsbedrag', 'Huidige vervallen facturen', CircleAlert, 'bg-red-100 text-red-700'],
];

export function KioskCompanyOverview({ Shell, onClose }) {
  const [summary, setSummary] = useState(null);
  const [period, setPeriod] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api.get('/kiosk/company-overview', {
      signal: controller.signal, params: period ? { period } : {},
    }).then(({ data }) => {
      if (!controller.signal.aborted) setSummary(data);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(`Overzicht laden is niet gelukt. ${formatError(err)}`);
    });
    return () => controller.abort();
  }, [period]);

  const monthLoading = Boolean(period && summary?.period !== period);

  return (
    <Shell title="Overzicht" subtitle="Financieel overzicht van het bedrijf" Icon={BarChart3}
      testId="kiosk-company-overview" xwide onClose={onClose}>
      {summary && (
        <label className="flex items-center gap-3 text-sm font-bold text-slate-700">
          Maand
          <input type="month" value={period || summary.period} max={summary.current_period}
            className="rounded-lg border border-slate-200 px-3 py-2"
            onChange={(event) => {
              if (!event.target.value || event.target.value > summary.current_period) return;
              setError('');
              setPeriod(event.target.value);
            }} />
        </label>
      )}
      {(!summary || monthLoading) && !error && <Loader2 className="mx-auto my-8 h-7 w-7 animate-spin text-orange-600" aria-label="Overzicht laden" />}
      {summary && !monthLoading && (
        <div className="grid grid-cols-3 gap-3">
          {STATS.map(([key, title, caption, Icon, color]) => (
            <section key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`kiosk-overview-${key}`}>
              <Icon className={`mb-3 h-8 w-8 rounded-lg p-1.5 ${color}`} />
              <h4 className="text-sm font-bold text-slate-700">{title}</h4>
              {(Object.keys(summary[key]).length ? Object.entries(summary[key]).sort() : [['SRD', 0]]).map(([currency, amount]) => (
                <p key={currency} className="mt-1 break-words text-xl font-black text-slate-900">{fmtMoney(amount, currency)}</p>
              ))}
              <p className="mt-1 text-xs text-slate-500">{caption}</p>
            </section>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
    </Shell>
  );
}
