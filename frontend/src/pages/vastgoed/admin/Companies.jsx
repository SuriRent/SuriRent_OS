import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, Pencil, X, Check, Loader2, Building2, Users, KeySquare,
  Search, RefreshCw, ArrowUpRight, CalendarDays,
  CreditCard, Mail, Phone, MapPin, AlertCircle, LogIn, Clock3, Landmark, Receipt,
} from 'lucide-react';
import { api, formatError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const BILLING_STATUSES = {
  trial: { label: 'Proefperiode', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  active: { label: 'Actief abonnement', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  expired: { label: 'Verlopen', className: 'bg-red-50 text-red-700 ring-red-200' },
  past_due: { label: 'Betaling open', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  cancelled: { label: 'Opgezegd', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
};
const PLATFORM_COMPANY_SLUG = 'surirent';

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
};
const OPEN_INVOICE_EXCLUDED_STATUSES = ['paid', 'superseded', 'cancelled', 'void'];
const invoiceBalance = (invoice) => {
  const balance = Number(invoice.balance_due ?? (Number(invoice.amount || 0) - Number(invoice.paid_amount || 0)));
  return Number.isFinite(balance) ? Math.max(0, balance) : 0;
};
const formatInvoiceAmount = (amount, currency) => `${currency || 'SRD'} ${Number(amount || 0).toLocaleString('nl-NL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

function CompanyPaymentWizard({ company, onClose }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [invoices, setInvoices] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState('card');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/superadmin/subscription-invoices'),
      api.get('/saas-stripe/public-config'),
    ]).then(([invoiceResponse, stripeResponse]) => {
      if (!active) return;
      const openInvoices = (Array.isArray(invoiceResponse.data) ? invoiceResponse.data : [])
        .filter((invoice) => invoice.company_id === company.id
          && !OPEN_INVOICE_EXCLUDED_STATUSES.includes(invoice.status)
          && invoiceBalance(invoice) > 0)
        .sort((a, b) => String(a.period_start || a.created_at).localeCompare(String(b.period_start || b.created_at)));
      setInvoices(openInvoices);
      if (openInvoices.length > 0) setSelectedIds([openInvoices[0].id]);
      const availableMethods = stripeResponse.data?.enabled
        ? (stripeResponse.data.methods || []).filter((item) => ['card', 'ideal'].includes(item))
        : [];
      setMethods(availableMethods);
      if (availableMethods.length > 0) setMethod(availableMethods[0]);
    }).catch((e) => {
      if (active) setError(formatError(e, 'Facturen of betaalmethoden konden niet worden geladen.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [company.id]);

  const selectedInvoices = invoices.filter((invoice) => selectedIds.includes(invoice.id));
  const currency = selectedInvoices[0]?.currency || 'SRD';
  const total = selectedInvoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);

  const toggleInvoice = (invoice) => {
    setError('');
    if (selectedIds.includes(invoice.id)) {
      setSelectedIds((ids) => ids.filter((id) => id !== invoice.id));
      return;
    }
    if (selectedInvoices.length > 0 && selectedInvoices[0].currency !== invoice.currency) {
      setError('Facturen met verschillende valuta kunnen niet samen worden betaald.');
      return;
    }
    setSelectedIds((ids) => [...ids, invoice.id]);
  };

  const continueToCheckout = () => {
    if (selectedIds.length === 0 || !methods.includes(method)) return;
    const back = encodeURIComponent('/admin/companies');
    const ids = encodeURIComponent(selectedIds.join(','));
    navigate(`/saas/checkout/selectie?ids=${ids}&method=${method}&back=${back}`);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="company-payment-wizard">
      <section role="dialog" aria-modal="true" aria-labelledby="company-payment-title"
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-[#F7F8FA] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-wider text-orange-600">Abonnement betalen</p>
            <h2 id="company-payment-title" className="truncate text-xl font-black text-slate-900">{company.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Betaalvenster sluiten"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className={`rounded-full px-3 py-1 ${step === 1 ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>1. Facturen</span>
            <span className="h-px flex-1 bg-slate-200" />
            <span className={`rounded-full px-3 py-1 ${step === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>2. Betaalmethode</span>
          </div>

          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {loading ? (
            <div className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-orange-500" />Facturen laden…
            </div>
          ) : invoices.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
              <Receipt className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="font-bold text-slate-800">Geen openstaande facturen</p>
              <p className="mt-1 text-sm text-slate-500">Voor {company.name} zijn er geen abonnementsfacturen om te betalen.</p>
            </div>
          ) : step === 1 ? (
            <>
              <div className="space-y-2">
                {invoices.map((invoice) => {
                  const checked = selectedIds.includes(invoice.id);
                  return (
                    <label key={invoice.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 bg-white p-4 transition ${checked ? 'border-orange-400 ring-2 ring-orange-50' : 'border-slate-200 hover:border-slate-300'}`}
                      data-testid={`company-payment-invoice-${invoice.id}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleInvoice(invoice)}
                        className="mt-1 h-5 w-5 accent-[#FF5C00]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-black text-slate-900">Factuur #{(invoice.invoice_number || invoice.id.slice(0, 8)).toUpperCase()}</span>
                          <span className="font-black text-orange-600">{formatInvoiceAmount(invoiceBalance(invoice), invoice.currency)}</span>
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {invoice.plan || company.plan || 'Abonnement'} · {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
                          {invoice.due_date ? ` · Vervaldatum ${formatDate(invoice.due_date)}` : ''}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3">
                <span className="text-sm font-bold text-slate-600">{selectedInvoices.length} factuur{selectedInvoices.length === 1 ? '' : 'en'} geselecteerd</span>
                <span className="font-black text-slate-900">{formatInvoiceAmount(total, currency)}</span>
              </div>
              <button type="button" onClick={() => { setError(''); setStep(2); }} disabled={!selectedIds.length}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5C00] font-bold text-white hover:bg-[#E05200] disabled:cursor-not-allowed disabled:opacity-50">
                Verder naar betaalmethode <ArrowUpRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                {selectedInvoices.map((invoice) => (
                  <div key={invoice.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm">
                    <span className="min-w-0 truncate font-bold text-slate-700">
                      #{(invoice.invoice_number || invoice.id.slice(0, 8)).toUpperCase()} · {invoice.plan || company.plan || 'Abonnement'}
                    </span>
                    <span className="shrink-0 font-black text-slate-900">{formatInvoiceAmount(invoiceBalance(invoice), invoice.currency)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-xl bg-slate-950 px-4 py-3 text-white">
                  <span className="font-bold">Totaal te betalen</span>
                  <span className="text-lg font-black">{formatInvoiceAmount(total, currency)}</span>
                </div>
              </div>

              {methods.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Online betalen via Stripe is momenteel niet geactiveerd.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {methods.map((item) => {
                    const selected = method === item;
                    const Icon = item === 'ideal' ? Landmark : CreditCard;
                    const label = item === 'ideal' ? 'iDEAL' : 'Creditcard';
                    return (
                      <button key={item} type="button" onClick={() => setMethod(item)}
                        className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 bg-white px-4 text-left transition ${selected ? 'border-orange-400 ring-2 ring-orange-50' : 'border-slate-200 hover:border-slate-300'}`}
                        data-testid={`company-payment-method-${item}`}>
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Icon className="h-5 w-5" /></span>
                        <span className="flex-1 font-black text-slate-900">{label}</span>
                        <span className={`h-5 w-5 rounded-full border-2 ${selected ? 'border-orange-500 bg-orange-500 ring-2 ring-orange-100' : 'border-slate-300'}`} />
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-2">
                <button type="button" onClick={() => { setError(''); setStep(1); }}
                  className="h-12 flex-1 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50">
                  Terug
                </button>
                <button type="button" onClick={continueToCheckout} disabled={!methods.includes(method) || selectedIds.length === 0}
                  className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-[#FF5C00] font-bold text-white hover:bg-[#E05200] disabled:cursor-not-allowed disabled:opacity-50">
                  <CreditCard className="h-4 w-4" /> Doorgaan naar betalen
                </button>
              </div>
              <p className="text-center text-xs text-slate-500">De veilige betaling wordt verwerkt via Stripe.</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function CompanyDetails({ company, plan, selected, onClose, onEdit, onSelect, onOpenAsCustomer, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [days, setDays] = useState(14);
  const status = BILLING_STATUSES[company.billing_status] || {
    label: company.billing_status || 'Onbekend',
    className: 'bg-slate-100 text-slate-600 ring-slate-200',
  };

  const runAction = async (action, path, body) => {
    setBusy(action);
    setError('');
    try {
      await api.post(path, body);
      await onChanged();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy('');
    }
  };

  const cancelSubscription = () => {
    if (!window.confirm(`Weet je zeker dat je het abonnement van ${company.name} wilt opzeggen?`)) return;
    runAction('cancel', `/companies/${company.id}/cancel-subscription`);
  };

  const openCustomerEnvironment = async () => {
    setError('');
    try {
      await onOpenAsCustomer(company);
    } catch (e) {
      setError(formatError(e, 'Klantomgeving kon niet worden geopend'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex justify-end" data-testid="company-details-overlay">
      <button type="button" aria-label="Bedrijfsdetails sluiten" onClick={onClose} className="absolute inset-0 cursor-default" />
      <section role="dialog" aria-modal="true" aria-labelledby="company-details-title"
        className="relative w-full sm:max-w-2xl h-full overflow-y-auto bg-[#F7F8FA] shadow-2xl">
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-5 sm:px-6 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] font-extrabold text-orange-600">Bedrijfsbeheer</p>
            <h2 id="company-details-title" className="text-xl font-black text-slate-900 truncate">{company.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Sluiten" className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          <div className="rounded-2xl bg-slate-950 p-4 text-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">Pakket</p>
                <p className="text-xl font-black mt-0.5 break-words">{plan?.name || company.plan || 'Geen pakket'}</p>
                <p className="text-sm text-white/80">{company.currency || 'SRD'} {Number(company.monthly_amount || 0).toLocaleString('nl-NL')} / {company.plan_interval || 'maand'}</p>
              </div>
              <CreditCard className="w-6 h-6 text-orange-300 shrink-0" />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-extrabold ring-1 ring-inset ${status.className}`}>Abonnement: {status.label}</span>
              {company.active === false && <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white/90">Platformtoegang uit</span>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Appartementen', value: company.stats?.apartments ?? '—', icon: Building2 },
              { label: 'Huurders', value: company.stats?.tenants ?? '—', icon: Users },
              { label: 'Gebruikers', value: company.stats?.admins ?? '—', icon: KeySquare },
            ].map((item) => {
              const Icon = item.icon;
              return <div key={item.label} className="rounded-xl bg-white border border-slate-200 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xl font-black text-slate-900">{item.value}</p>
                  <Icon className="w-4 h-4 text-orange-600 shrink-0" />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 leading-tight">{item.label}</p>
              </div>;
            })}
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 grid sm:grid-cols-2">
            <div className="p-3 flex items-start gap-2.5 border-b border-slate-100 sm:border-r">
              <Building2 className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
              <div className="min-w-0"><p className="text-xs font-bold text-slate-600">Bedrijf</p><p className="text-sm font-semibold text-slate-900 break-words">{company.name} <span className="text-slate-500 font-normal">/{company.slug}</span></p></div>
            </div>
            <div className="p-3 flex items-start gap-2.5 border-b border-slate-100">
              <Mail className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
              <div className="min-w-0"><p className="text-xs font-bold text-slate-600">Contact</p><p className="text-sm text-slate-900 break-all">{company.contact_email || company.owner_email || 'Geen e-mailadres opgegeven'}</p></div>
            </div>
            {company.contact_phone && <div className="p-3 flex items-start gap-2.5 border-b border-slate-100 sm:border-r"><Phone className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" /><div className="min-w-0"><p className="text-xs font-bold text-slate-600">Telefoon</p><p className="text-sm text-slate-900 break-words">{company.contact_phone}</p></div></div>}
            {company.address && <div className="p-3 flex items-start gap-2.5 border-b border-slate-100"><MapPin className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" /><div className="min-w-0"><p className="text-xs font-bold text-slate-600">Adres</p><p className="text-sm text-slate-900 break-words">{company.address}</p></div></div>}
            <div className="p-3 grid grid-cols-2 gap-2 sm:col-span-2">
              <div className="flex items-start gap-2"><CalendarDays className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" /><div className="min-w-0"><p className="text-xs font-bold text-slate-600">Proefperiode tot</p><p className="text-sm text-slate-900">{formatDate(company.trial_ends_at)}</p></div></div>
              <div className="flex items-start gap-2"><Clock3 className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" /><div className="min-w-0"><p className="text-xs font-bold text-slate-600">Verlenging</p><p className="text-sm text-slate-900">{formatDate(company.subscription_renews_at || company.next_billing_date)}</p></div></div>
            </div>
          </div>

          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          <div className="rounded-2xl bg-white border border-slate-200 p-3">
            <div className="grid sm:grid-cols-2 gap-2">
              <button type="button" onClick={openCustomerEnvironment} disabled={!!busy}
                className="sm:col-span-2 w-full min-h-10 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                <LogIn className="w-4 h-4" /> Klantomgeving openen
              </button>
              <button type="button" onClick={onEdit} disabled={!!busy} className="h-10 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-bold text-slate-700 flex items-center justify-center gap-2 disabled:opacity-50">
                <Pencil className="w-4 h-4" /> Gegevens wijzigen
              </button>
              <button type="button" onClick={() => onSelect(selected ? null : company)} disabled={!!busy} className="h-10 rounded-xl border border-orange-200 bg-orange-50 hover:bg-orange-100 text-sm font-bold text-orange-700 flex items-center justify-center gap-2 disabled:opacity-50">
                {selected ? <Check className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                {selected ? 'Wis bedrijfsscope' : 'Selecteer bedrijfsscope'}
              </button>
              {company.billing_status === 'trial' && (
                <div className="sm:col-span-2 flex gap-2 pt-2 border-t border-slate-100">
                  <select aria-label="Dagen proefperiode verlengen" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm">
                    {[7, 14, 30, 60, 90].map((value) => <option key={value} value={value}>{value} dagen</option>)}
                  </select>
                  <button type="button" onClick={() => runAction('extend', `/companies/${company.id}/extend-trial`, { days })} disabled={!!busy}
                    className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-50">
                    {busy === 'extend' ? 'Bezig…' : 'Proef verlengen'}
                  </button>
                </div>
              )}
              {['cancelled', 'expired'].includes(company.billing_status) && (
                <button type="button" onClick={() => {
                  if (window.confirm(`Heractiveer het abonnement en de toegang voor ${company.name}?`)) {
                    runAction('reactivate', `/companies/${company.id}/reactivate-subscription`);
                  }
                }} disabled={!!busy} data-testid="company-reactivate"
                  className="sm:col-span-2 w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50">
                  {busy === 'reactivate' ? 'Bezig…' : 'Abonnement heractiveren'}
                </button>
              )}
              {['active', 'trial'].includes(company.billing_status) && (
                <button type="button" onClick={cancelSubscription} disabled={!!busy}
                  className="sm:col-span-2 w-full h-10 rounded-xl border border-red-200 hover:bg-red-50 text-red-700 text-sm font-bold disabled:opacity-50">
                  {busy === 'cancel' ? 'Bezig…' : 'Abonnement opzeggen'}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function CompanyForm({ initial, onCancel, onSaved }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(initial || {
    name: '', slug: '', contact_email: '', contact_phone: '',
    address: '', plan: 'starter', active: true,
  });
  const [seedAdmin, setSeedAdmin] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  // Dynamische plans uit de SaaS Pakketten catalog (endpoint
  // `/superadmin/plans`). Voorheen was de dropdown hardcoded op
  // free/starter/pro terwijl de superadmin in Pakketten andere plans kan
  // aanmaken — waardoor selectie hier niet klopte met de echte pakketten.
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/superadmin/plans');
        if (!alive) return;
        const list = Array.isArray(data) ? data : [];
        setPlans(list);
        // Als het huidige plan van de company niet meer in de catalog staat
        // (bv. hernoemd/verwijderd), val terug op het eerste actieve plan
        // zodat we geen "ghost" waarde in de dropdown houden.
        if (list.length > 0) {
          const hasCurrent = list.some((p) => p.id === form.plan);
          if (!hasCurrent) {
            const firstActive = list.find((p) => p.active !== false) || list[0];
            if (firstActive) setForm((f) => ({ ...f, plan: firstActive.id }));
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[companies] kon plans niet laden', e);
      } finally {
        if (alive) setPlansLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line

  const submit = async () => {
    setErr(''); setLoading(true);
    try {
      let company;
      if (isEdit) {
        const { data } = await api.put(`/companies/${initial.id}`, form);
        company = data;
      } else {
        const { data } = await api.post('/companies', form);
        company = data;
        // Optional seed admin
        if (seedAdmin.email && seedAdmin.password && seedAdmin.name) {
          await api.post(`/companies/${company.id}/seed-admin`, seedAdmin);
        }
      }
      onSaved(company);
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white/30 backdrop-blur-md flex items-center justify-center p-4 modal-sheet-auto"
      data-testid="company-form-modal" data-superadmin-fullscreen-dialog="true">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-black text-slate-900">{isEdit ? 'Bedrijf bewerken' : 'Nieuw bedrijf'}</h2>
          <button onClick={onCancel} data-testid="company-form-close" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Bedrijfsnaam *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="company-name"
                className="w-full mt-1 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Slug (URL-vriendelijk) *</label>
              <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                data-testid="company-slug"
                className="w-full mt-1 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
              {isEdit && <p className="text-[11px] text-slate-500 mt-1">Let op: bij wijzigen verandert de inloglink (/{form.slug || 'slug'}/login). Oude links werken dan niet meer.</p>}
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Contact e-mail</label>
              <input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                data-testid="company-email"
                className="w-full mt-1 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Contact telefoon</label>
              <input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                data-testid="company-phone"
                className="w-full mt-1 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Adres</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                data-testid="company-address"
                className="w-full mt-1 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Plan {plansLoading && <span className="text-slate-400">(laden…)</span>}
              </label>
              <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
                data-testid="company-plan"
                disabled={plansLoading}
                className="w-full mt-1 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white disabled:opacity-60">
                {plans.length === 0 && !plansLoading && (
                  <option value={form.plan}>{form.plan}</option>
                )}
                {plans.map((p) => {
                  const price = p.amount != null
                    ? ` — ${p.currency || 'SRD'} ${Number(p.amount).toLocaleString('nl-NL')}${p.interval ? '/' + p.interval : ''}`
                    : '';
                  const inactiveTag = p.active === false ? ' (inactief)' : '';
                  return (
                    <option key={p.id} value={p.id}>
                      {(p.name || p.id) + price + inactiveTag}
                    </option>
                  );
                })}
              </select>
              {plans.length > 0 && (() => {
                const cur = plans.find((p) => p.id === form.plan);
                return cur?.description ? (
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">{cur.description}</p>
                ) : null;
              })()}
            </div>
            <div className="flex items-center gap-3 pt-6">
              <input type="checkbox" id="company-active" checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                data-testid="company-active"
                className="w-5 h-5 accent-[#FF5C00]" />
              <label htmlFor="company-active" className="text-sm font-semibold text-slate-700">Actief</label>
            </div>
          </div>

          {!isEdit && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Eerste admin (optioneel)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input placeholder="Naam" value={seedAdmin.name} onChange={(e) => setSeedAdmin({ ...seedAdmin, name: e.target.value })}
                  data-testid="seed-admin-name"
                  className="h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
                <input placeholder="E-mail" type="email" value={seedAdmin.email} onChange={(e) => setSeedAdmin({ ...seedAdmin, email: e.target.value })}
                  data-testid="seed-admin-email"
                  className="h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
                <input placeholder="Wachtwoord" type="password" value={seedAdmin.password} onChange={(e) => setSeedAdmin({ ...seedAdmin, password: e.target.value })}
                  data-testid="seed-admin-password"
                  className="h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
              </div>
              <p className="text-[11px] text-slate-400 mt-2">Vul in om direct een admin login aan te maken voor dit bedrijf.</p>
            </div>
          )}

          {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onCancel} data-testid="company-form-cancel"
              className="flex-1 h-11 rounded-xl border-2 border-slate-200 text-slate-700 font-bold hover:bg-slate-50">
              Annuleren
            </button>
            <button onClick={submit} disabled={loading || !form.name || !form.slug} data-testid="company-form-submit"
              className="flex-1 h-11 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {isEdit ? 'Opslaan' : 'Aanmaken'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Companies({ searchQuery, onSearchQueryChange, createRequest, refreshRequest }) {
  const { user, setActiveCompany, activeCompanyId } = useAuth();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [paymentCompany, setPaymentCompany] = useState(null);
  const [impersonating, setImpersonating] = useState(false);
  // Plan-catalog ook op lijst-niveau ophalen zodat we op elke bedrijfskaart
  // de LEESBARE plan-naam kunnen tonen i.p.v. de plan_id ("professional"
  // → "Professional"). Voorkomt verwarring met de SaaS Pakketten labels.
  const [planMap, setPlanMap] = useState({});

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data } = await api.get('/companies');
      setItems(Array.isArray(data) ? data : []);
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (refreshRequest > 0) load();
  }, [refreshRequest, load]);
  useEffect(() => {
    if (createRequest > 0) {
      setEditing(null);
      setShowForm(true);
    }
  }, [createRequest]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/superadmin/plans');
        if (!alive) return;
        const map = {};
        (Array.isArray(data) ? data : []).forEach((p) => { map[p.id] = p; });
        setPlanMap(map);
      } catch (_) { /* stil falen — kaart valt terug op id */ }
    })();
    return () => { alive = false; };
  }, []);

  const onDelete = async (c) => {
    if (!window.confirm(`Bedrijf "${c.name}" verwijderen?\n\nDit kan alleen als er geen data (appartementen, huurders, etc.) meer is.`)) return;
    try {
      await api.delete(`/companies/${c.id}`);
      if (selectedCompany?.id === c.id) setSelectedCompany(null);
      await load();
    } catch (e) { alert(formatError(e)); }
  };

  const openCustomerEnvironment = async (company) => {
    if (!window.confirm(`Open de klantomgeving van ${company.name} in supportmodus? Deze actie wordt vastgelegd.`)) return;
    setImpersonating(true);
    setErr('');
    try {
      const { data } = await api.post(`/superadmin/companies/${company.id}/impersonate`);
      if (!data?.token) throw new Error('De support-sessie kon niet worden gestart.');
      try { sessionStorage.setItem('superadmin_impersonation', JSON.stringify({ returnPath: '/admin/companies' })); } catch { /* non-blocking */ }
      localStorage.setItem('admin_token', data.token);
      localStorage.removeItem('active_company_id');
      window.location.assign('/admin');
    } catch (e) {
      setImpersonating(false);
      throw e;
    }
  };

  const isSuper = user?.role === 'superadmin';
  const customerItems = items.filter((company) => String(company.slug || '').toLowerCase() !== PLATFORM_COMPANY_SLUG);
  const activeCompanyIsPlatform = customerItems.length !== items.length
    && items.some((company) => company.id === activeCompanyId && String(company.slug || '').toLowerCase() === PLATFORM_COMPANY_SLUG);
  const scopedItems = activeCompanyId && !activeCompanyIsPlatform
    ? customerItems.filter((company) => company.id === activeCompanyId)
    : customerItems;
  const visibleItems = scopedItems.filter((company) => {
    const term = searchQuery.trim().toLowerCase();
    const matchesQuery = !term || [
      company.name, company.slug, company.contact_email, company.owner_email, company.plan,
    ].some((value) => String(value || '').toLowerCase().includes(term));
    const status = company.billing_status || 'active';
    const matchesFilter = filter === 'all'
      || (filter === 'trial' && status === 'trial')
      || (filter === 'active' && status === 'active')
      || (filter === 'attention' && ['expired', 'past_due', 'cancelled'].includes(status))
      || (filter === 'disabled' && company.active === false);
    return matchesQuery && matchesFilter;
  });
  const counts = {
    all: scopedItems.length,
    active: scopedItems.filter((company) => company.billing_status === 'active').length,
    trial: scopedItems.filter((company) => company.billing_status === 'trial').length,
    attention: scopedItems.filter((company) => ['expired', 'past_due', 'cancelled'].includes(company.billing_status)).length,
  };

  if (!isSuper) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-sm text-amber-800">
        Deze sectie is alleen beschikbaar voor superadmins.
      </div>
    );
  }

  return (
    <div data-testid="companies-management-page" className="space-y-3 pb-24 sm:pb-6">
      <div className="flex justify-end gap-2 xl:hidden">
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          data-testid="company-new-btn"
          className="h-10 px-3 sm:px-4 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white text-sm font-bold flex items-center gap-2 shadow-[0_6px_15px_-3px_rgba(255,92,0,0.5)]">
          <Plus className="w-4 h-4" /> Nieuw bedrijf
        </button>
        <button onClick={load} disabled={loading} data-testid="company-refresh"
          aria-label="Bedrijven vernieuwen"
          className="h-10 w-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {err && <div role="alert" className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"><AlertCircle className="w-4 h-4 shrink-0" />{err}</div>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { id: 'all', label: 'Alle bedrijven', value: counts.all, color: 'text-slate-900' },
          { id: 'active', label: 'Actieve abonnementen', value: counts.active, color: 'text-emerald-700' },
          { id: 'trial', label: 'Proefperiodes', value: counts.trial, color: 'text-amber-700' },
          { id: 'attention', label: 'Aandacht nodig', value: counts.attention, color: 'text-red-700' },
        ].map((item) => (
          <button key={item.id} type="button" onClick={() => setFilter(item.id)}
            className={`rounded-2xl border bg-white p-2.5 text-left transition ${filter === item.id ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-200 hover:border-slate-300'}`}>
              <p className="text-[10px] leading-tight font-bold text-slate-500">{item.label}</p>
              <p className={`text-lg font-black mt-0.5 ${item.color}`}>{loading ? '—' : item.value}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_138px] gap-2 sm:grid-cols-[minmax(0,1fr)_auto] xl:flex xl:justify-end">
        <div className="relative min-w-0 xl:hidden">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={searchQuery} onChange={(e) => onSearchQueryChange(e.target.value)} placeholder="Zoek bedrijf, slug, contactpersoon of pakket"
            aria-label="Bedrijven zoeken" data-testid="company-search"
            className="w-full h-9 rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-xs sm:text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter bedrijven"
          className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 sm:px-3 sm:text-sm xl:w-48">
          <option value="all">Alle status</option>
          <option value="active">Actief abonnement</option>
          <option value="trial">Proefperiode</option>
          <option value="attention">Aandacht nodig</option>
          <option value="disabled">Toegang uitgeschakeld</option>
        </select>
      </div>

      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-100 p-12 text-center text-slate-400 text-sm"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />Bedrijven laden…</div>
      ) : err && items.length === 0 ? (
        <div className="rounded-2xl bg-white border border-red-100 p-10 text-center">
          <AlertCircle className="w-10 h-10 text-red-300 mx-auto mb-3" />
          <p className="font-bold text-slate-700">Bedrijven konden niet worden geladen.</p>
          <button type="button" onClick={load} className="mt-4 h-10 px-4 rounded-xl bg-slate-900 text-white text-sm font-bold">Opnieuw proberen</button>
        </div>
      ) : scopedItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-orange-100 p-10 text-center">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Nog geen bedrijven. Maak het eerste bedrijf aan.</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <Search className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="font-bold text-slate-700">Geen bedrijven gevonden</p>
          <p className="text-sm text-slate-500 mt-1">Pas je zoekopdracht of filter aan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((c) => {
            const isActive = c.id === activeCompanyId;
            const billing = BILLING_STATUSES[c.billing_status] || BILLING_STATUSES.active;
            return (
              <div key={c.id} data-testid={`company-card-${c.slug}`}
                className={`flex flex-col rounded-3xl border bg-white p-4 shadow-sm transition-all ${isActive ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-200 hover:border-orange-200 hover:shadow-md'}`}>
                <div className="flex items-start gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-orange-600">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <h3 className="max-w-full truncate font-black text-slate-900">{c.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ring-1 ring-inset ${billing.className}`}>{billing.label}</span>
                      {isActive && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-extrabold text-orange-700">Scope actief</span>}
                      {c.active === false && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-500">Toegang uit</span>}
                    </div>
                    <p className="truncate text-xs font-semibold text-slate-600">{planMap[c.plan]?.name || c.plan} · {c.currency || 'SRD'} {Number(c.monthly_amount || 0).toLocaleString('nl-NL')}/{c.plan_interval || 'maand'}</p>
                    <p className="mt-1 truncate text-xs text-slate-400">{c.contact_email || c.owner_email || 'Geen contact-e-mailadres'}</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-400">/{c.slug}</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    { label: 'Appartementen', value: c.stats?.apartments ?? '—' },
                    { label: 'Huurders', value: c.stats?.tenants ?? '—' },
                    { label: 'Gebruikers', value: c.stats?.admins ?? '—' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl bg-slate-50 px-2 py-2.5 text-center">
                      <p className="text-lg font-black text-slate-900">{item.value}</p>
                      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => setPaymentCompany(c)}
                    data-testid={`company-pay-${c.slug}`}
                    className="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-3 text-xs font-extrabold text-white hover:bg-[#E05200]">
                    <CreditCard className="h-4 w-4" /> Betalen
                  </button>
                  <button type="button" onClick={() => setSelectedCompany(c)}
                      data-testid={`company-manage-${c.slug}`}
                    className="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-extrabold text-white hover:bg-slate-800">
                    Beheren <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => { setEditing(c); setShowForm(true); }}
                    data-testid={`company-edit-${c.slug}`}
                    aria-label={`${c.name} bewerken`} title="Gegevens wijzigen"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => onDelete(c)}
                    data-testid={`company-delete-${c.slug}`}
                    aria-label={`${c.name} verwijderen`} title="Verwijderen"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 hover:bg-red-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <CompanyForm
          initial={editing}
          onCancel={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
      {selectedCompany && (
        <CompanyDetails
          company={items.find((company) => company.id === selectedCompany.id) || selectedCompany}
          plan={planMap[selectedCompany.plan]}
          selected={selectedCompany.id === activeCompanyId}
          onClose={() => setSelectedCompany(null)}
          onEdit={() => { setEditing(items.find((company) => company.id === selectedCompany.id) || selectedCompany); setSelectedCompany(null); setShowForm(true); }}
          onSelect={(company) => setActiveCompany(company?.id || null)}
          onOpenAsCustomer={openCustomerEnvironment}
          onChanged={load}
        />
      )}
      {paymentCompany && (
        <CompanyPaymentWizard company={paymentCompany} onClose={() => setPaymentCompany(null)} />
      )}
      {impersonating && (
        <div className="fixed inset-0 z-[60] bg-slate-950/60 flex items-center justify-center p-5" role="status">
          <div className="rounded-2xl bg-white p-6 text-center shadow-xl"><Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-3" /><p className="font-bold text-slate-900">Klantomgeving openen…</p></div>
        </div>
      )}
    </div>
  );
}
