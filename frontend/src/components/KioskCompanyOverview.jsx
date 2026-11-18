import { useEffect, useState } from 'react';
import { BarChart3, CircleAlert, Droplets, Loader2, Wallet, Wifi, Zap, CircleCheck } from 'lucide-react';
import { api, fmtMoney, formatError } from '../lib/api';

const STATS = [
  ['paid', 'Betaald bedrag', 'Ontvangen in de gekozen maand', CircleCheck, 'bg-emerald-100 text-emerald-700'],
  ['outstanding', 'Openstaand bedrag', 'Huidig saldo, inclusief achterstand', Wallet, 'bg-orange-100 text-orange-700'],
  ['overdue', 'Achterstandsbedrag', 'Huidige vervallen facturen', CircleAlert, 'bg-red-100 text-red-700'],
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
  const [period, setPeriod] = useState('');
  const [fields, setFields] = useState({});
  const [selections, setSelections] = useState({});
  const [expenses, setExpenses] = useState(null);
  const [expenseError, setExpenseError] = useState('');
  const [editAccess, setEditAccess] = useState(null);
  const [accessError, setAccessError] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/admin/kiosk-utility-amounts', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setEditAccess(data);
    }).catch((err) => {
      if (controller.signal.aborted) return;
      if (err.response?.status === 403) setEditAccess({ company_id: null });
      else setAccessError(true);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/kiosk/company-overview', {
      signal: controller.signal, params: period ? { period } : {},
    }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setSummary(data);
      setFields(Object.fromEntries(PROVIDERS.map(([key]) => [key, String(data.utilities[key] ?? '')])));
    }).catch((err) => {
      if (!controller.signal.aborted) setError(`Overzicht laden is niet gelukt. ${formatError(err)}`);
    });
    return () => controller.abort();
  }, [period]);

  const canEdit = Boolean(summary?.company_id && editAccess?.company_id === summary.company_id);
  const editableCompany = canEdit ? summary.company_id : null;
  useEffect(() => {
    if (!editableCompany) return undefined;
    const controller = new AbortController();
    api.get('/admin/kiosk-utility-expenses', {
      signal: controller.signal, params: { company_id: editableCompany },
    }).then(({ data }) => {
      if (!controller.signal.aborted) setExpenses(data);
    }).catch((err) => {
      if (!controller.signal.aborted) setExpenseError(`Kasuitgaven laden is niet gelukt. ${formatError(err)}`);
    });
    return () => controller.abort();
  }, [editableCompany]);

  const save = async (event) => {
    event.preventDefault();
    if (saving || !canEdit) return;
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const amounts = Object.fromEntries(PROVIDERS.map(([key]) => [key, parseUtilityAmount(fields[key])]));
      const { data } = await api.put('/admin/kiosk-utility-amounts', {
        company_id: summary.company_id, period: summary.period, ...amounts,
      });
      setSummary((previous) => ({ ...previous, utilities: data.utilities }));
      setSaved(true);
    } catch (err) {
      setError(formatError(err, 'Bedragen opslaan is niet gelukt.'));
    } finally {
      setSaving(false);
    }
  };

  const changeLink = async (provider, entry, linked) => {
    if (!canEdit || saving || !entry) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.put('/admin/kiosk-utility-expenses', {
        company_id: summary.company_id, period: summary.period, provider, entry_id: entry.id, linked,
      });
      setSummary((previous) => ({
        ...previous,
        utility_payments: {
          ...previous.utility_payments,
          [provider]: linked
            ? [entry, ...previous.utility_payments[provider].filter((item) => item.id !== entry.id)]
            : previous.utility_payments[provider].filter((item) => item.id !== entry.id),
        },
      }));
      setExpenses((previous) => linked ? previous.filter((item) => item.id !== entry.id) : [entry, ...(previous || [])]);
      setSelections((previous) => Object.fromEntries(Object.entries(previous).filter(([, id]) => id !== entry.id)));
    } catch (err) {
      setError(formatError(err, 'De koppeling kon niet worden opgeslagen.'));
    } finally {
      setSaving(false);
    }
  };

  const monthLoading = Boolean(period && summary?.period !== period);
  const expenseLabel = (entry) => [
    (entry.entry_date || entry.created_at || '').slice(0, 10), entry.description || 'Kasuitgave',
    fmtMoney(entry.amount, 'SRD'),
  ].filter(Boolean).join(' · ');

  return (
    <Shell title="Overzicht" subtitle="Financieel overzicht van het bedrijf" Icon={BarChart3}
      testId="kiosk-company-overview" xwide onClose={() => { if (!saving) onClose(); }}>
      {summary && (
        <label className="flex items-center gap-3 text-sm font-bold text-slate-700">
          Maand
          <input type="month" value={period || summary.period} max={summary.current_period} disabled={saving}
            className="rounded-lg border border-slate-200 px-3 py-2"
            onChange={(event) => {
              if (!event.target.value || event.target.value > summary.current_period) return;
              setError('');
              setSaved(false);
              setSelections({});
              setPeriod(event.target.value);
            }} />
        </label>
      )}
      {(!summary || monthLoading) && !error && <Loader2 className="mx-auto my-8 h-7 w-7 animate-spin text-orange-600" aria-label="Overzicht laden" />}
      {summary && !monthLoading && (
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
            <p className="text-sm text-slate-600">Koppel bestaande uitgaven uit Kasgeld. Er wordt geen nieuwe kasmutatie geboekt.</p>
            {expenseError && <p role="alert" className="text-sm text-red-700">{expenseError}</p>}
            {accessError && <p role="alert" className="text-sm text-red-700">Bewerkrechten controleren is niet gelukt. Sluit het overzicht en open het opnieuw.</p>}
            {editAccess && !canEdit && <p className="text-sm text-slate-600">Alleen een beheerder of eigenaar van dit bedrijf kan deze bedragen wijzigen.</p>}
            <div className="grid grid-cols-3 gap-3">
              {PROVIDERS.map(([key, title, Icon]) => {
                const payments = summary.utility_payments[key];
                const due = summary.utilities[key];
                const paid = payments.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0);
                const remaining = due == null ? null : Math.max(0, Math.round(due * 100) - paid);
                const status = due == null ? null : remaining === 0 ? 'Voldaan' : paid ? 'Deels betaald' : 'Openstaand';
                return (
                <section key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <Icon className="mb-3 h-8 w-8 rounded-lg bg-sky-100 p-1.5 text-sky-700" />
                  <h5 className="font-black text-slate-900">{title}</h5>
                  <p className="mt-1 text-xs font-semibold text-slate-600">Te betalen (SRD)</p>
                  <p className="mb-2 break-words text-xl font-black text-slate-900">
                    {summary.utilities[key] == null ? 'Geen bedrag ingesteld' : fmtMoney(summary.utilities[key], 'SRD')}
                  </p>
                  {canEdit && (
                    <input id={`utility-${key}`} aria-label={`${title}: te betalen bedrag in SRD`}
                      inputMode="decimal" value={fields[key] ?? ''} disabled={saving}
                      onChange={(event) => { setFields((previous) => ({ ...previous, [key]: event.target.value })); setSaved(false); }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                      placeholder="0,00" />
                  )}
                  {status && <p className="mt-3 text-sm font-bold text-slate-800">{status}</p>}
                  <p className="mt-2 text-xs text-slate-600">Betaald via Kasgeld: {fmtMoney(paid / 100, 'SRD')}</p>
                  {remaining != null && <p className="text-xs text-slate-600">Nog te betalen: {fmtMoney(remaining / 100, 'SRD')}</p>}
                  {payments.map((entry) => (
                    <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600" key={entry.id}>
                      {expenseLabel(entry)}
                      {canEdit && <button type="button" disabled={saving}
                        onClick={() => changeLink(key, entry, false)} className="ml-2 font-semibold text-red-700">Ontkoppelen</button>}
                    </div>
                  ))}
                  {canEdit && (
                    <div className="mt-3 space-y-2">
                      <select aria-label={`${title}: bestaande kasuitgave`} value={selections[key] || ''}
                        disabled={saving || !expenses?.length}
                        onChange={(event) => setSelections((previous) => ({ ...previous, [key]: event.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-700">
                        <option value="">{expenses?.length ? 'Kies een recente kasuitgave' : expenses ? 'Geen ongekoppelde SRD-uitgaven' : 'Kasuitgaven laden…'}</option>
                        {expenses?.map((entry) => <option key={entry.id} value={entry.id}>{expenseLabel(entry)}</option>)}
                      </select>
                      <button type="button" disabled={saving || !selections[key]}
                        onClick={() => changeLink(key, expenses.find((entry) => entry.id === selections[key]), true)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-50">Kasuitgave koppelen</button>
                    </div>
                  )}
                </section>
                );
              })}
            </div>
            {canEdit && <div className="flex items-center justify-end gap-3">
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
