import { useEffect, useState } from 'react';
import { BarChart3, CircleAlert, Droplets, Loader2, Wallet, Wifi, Zap, CircleCheck } from 'lucide-react';
import { api, fmtMoney, formatError } from '../lib/api';

const STATS = [
  ['paid', 'Betaald bedrag', 'Ontvangen deze maand', CircleCheck, 'bg-emerald-100 text-emerald-700'],
  ['outstanding', 'Openstaand bedrag', 'Inclusief achterstand', Wallet, 'bg-orange-100 text-orange-700'],
  ['overdue', 'Achterstandsbedrag', 'Vervallen facturen', CircleAlert, 'bg-red-100 text-red-700'],
];

const PROVIDERS = [
  ['ebs', 'EBS', Zap],
  ['swm', 'SWM', Droplets],
  ['telesur', 'Telesur', Wifi],
];

export function parseUtilityAmount(input) {
  const cleaned = input.trim();
  if (!cleaned) return null;
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(cleaned) || Number(cleaned.replace(',', '.')) > 1_000_000_000) {
    throw new Error('Vul een geldig bedrag in met maximaal twee decimalen.');
  }
  return Number(cleaned.replace(',', '.'));
}

export function KioskCompanyOverview({ Shell, onClose }) {
  const [summary, setSummary] = useState(null);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/kiosk/company-overview', { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setSummary(data);
      setFields(Object.fromEntries(PROVIDERS.map(([key]) => [key, String(data.utilities[key] ?? '')])));
    }).catch((err) => {
      if (!controller.signal.aborted) setError(`Overzicht laden is niet gelukt. ${formatError(err)}`);
    });
    return () => controller.abort();
  }, []);

  const save = async (event) => {
    event.preventDefault();
    if (saving || !summary?.can_edit_utilities) return;
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const amounts = Object.fromEntries(PROVIDERS.map(([key]) => [key, parseUtilityAmount(fields[key])]));
      const { data } = await api.put('/admin/kiosk-utility-amounts', { company_id: summary.company_id, ...amounts });
      setSummary((previous) => ({ ...previous, utilities: data.utilities }));
      setSaved(true);
    } catch (err) {
      setError(formatError(err, 'Bedragen opslaan is niet gelukt.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell title="Overzicht" subtitle="Financieel overzicht van het bedrijf" Icon={BarChart3}
      testId="kiosk-company-overview" xwide onClose={() => { if (!saving) onClose(); }}>
      {!summary && !error && <Loader2 className="mx-auto my-8 h-7 w-7 animate-spin text-orange-600" aria-label="Overzicht laden" />}
      {summary && (
        <>
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
          <form onSubmit={save} className="space-y-3">
            <h4 className="font-black text-slate-900">Vaste lasten</h4>
            <div className="grid grid-cols-3 gap-3">
              {PROVIDERS.map(([key, title, Icon]) => (
                <section key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <Icon className="mb-3 h-8 w-8 rounded-lg bg-sky-100 p-1.5 text-sky-700" />
                  <h5 className="font-black text-slate-900">{title}</h5>
                  <p className="mt-1 text-xs font-semibold text-slate-600">Te betalen (SRD)</p>
                  <p className="mb-2 break-words text-xl font-black text-slate-900">
                    {summary.utilities[key] == null ? 'Geen bedrag ingesteld' : fmtMoney(summary.utilities[key], 'SRD')}
                  </p>
                  {summary.can_edit_utilities && (
                    <input id={`utility-${key}`} aria-label={`${title}: te betalen bedrag in SRD`}
                      inputMode="decimal" value={fields[key] ?? ''} disabled={saving}
                      onChange={(event) => { setFields((previous) => ({ ...previous, [key]: event.target.value })); setSaved(false); }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                      placeholder="0,00" />
                  )}
                </section>
              ))}
            </div>
            {summary.can_edit_utilities && <div className="flex items-center justify-end gap-3">
              {saved && <p role="status" className="text-sm font-semibold text-emerald-700">Bedragen opgeslagen</p>}
              <button type="submit" disabled={saving} className="rounded-xl bg-[#FF5C00] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {saving ? 'Opslaan…' : 'Bedragen opslaan'}
              </button>
            </div>}
          </form>
        </>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
    </Shell>
  );
}
