import { useState, useEffect, useCallback } from 'react';
import {
  Landmark, Mail, Globe, Check, Loader2, Save, AlertCircle, Send, RefreshCw, UserCog, CreditCard, Zap,
} from 'lucide-react';
import { api, formatError } from '../../../lib/api';

function Section({ title, icon: Icon, children, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent || 'bg-orange-100 text-orange-600'}`}>
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
      </div>
      <div className="p-5 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, hint, mono, testid }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">{label}</label>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} data-testid={testid}
        className={`w-full h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-orange-500 outline-none ${mono ? 'font-mono text-sm' : ''}`} />
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({ label, value, onChange, hint, testid }) {
  return (
    <button type="button" onClick={() => onChange(!value)} data-testid={testid}
      className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition">
      <div className="text-left">
        <p className="text-sm font-bold text-slate-900">{label}</p>
        {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <div className={`relative w-10 h-6 rounded-full transition ${value ? 'bg-orange-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
      </div>
    </button>
  );
}

function StripeSection() {
  const [cfg, setCfg] = useState(null);
  const [mode, setMode] = useState('test');
  const [keys, setKeys] = useState({ test: {}, live: {} });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });
  const webhookUrl = `${process.env.REACT_APP_BACKEND_URL}/api/saas-stripe/webhook`;

  const load = useCallback(async () => {
    const { data } = await api.get('/superadmin/stripe-config');
    setCfg(data); setMode(data.mode);
    setKeys({ test: { publishable_key: data.test.publishable_key }, live: { publishable_key: data.live.publishable_key } });
  }, []);
  useEffect(() => { load().catch((e) => setMsg({ type: 'err', text: formatError(e) })); }, [load]);

  const run = async (kind, fn, ok) => {
    setBusy(kind); setMsg({ type: '', text: '' });
    try { const r = await fn(); setMsg({ type: 'ok', text: ok(r) }); } catch (e) { setMsg({ type: 'err', text: formatError(e) }); }
    finally { setBusy(''); }
  };
  const save = () => run('save', async () => { await api.put('/superadmin/stripe-config', { mode, ...keys }); await load(); },
    () => `Stripe-instellingen opgeslagen (${mode === 'live' ? 'LIVE' : 'test'}-modus).`);
  const test = () => run('test', () => api.post('/superadmin/stripe-config/test'),
    ({ data }) => `Verbonden met ${data.name} (${data.mode === 'live' ? 'LIVE' : 'test'}).`);
  const setK = (m, f, v) => setKeys((k) => ({ ...k, [m]: { ...k[m], [f]: v } }));

  if (!cfg) return null;
  const k = cfg[mode];
  return (
    <Section title="Stripe betalingen (Creditcard & iDEAL)" icon={CreditCard} accent="bg-indigo-100 text-indigo-600">
      <div className="flex gap-2" data-testid="stripe-mode-toggle">
        {['test', 'live'].map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} data-testid={`stripe-mode-${m}`}
            className={`flex-1 h-11 rounded-xl font-bold text-sm transition-colors ${mode === m
              ? (m === 'live' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white')
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}>
            {m === 'live' ? 'Live (echte betalingen)' : 'Testmodus'}
          </button>
        ))}
      </div>
      {mode === 'live' && cfg.mode !== 'live' && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
          Na opslaan worden alle klantbetalingen echt afgeschreven. Vul eerst uw live sleutels in.
        </p>
      )}
      <Field label={`Publishable key (${mode})`} mono value={keys[mode].publishable_key}
        placeholder={`pk_${mode}_...`} onChange={(v) => setK(mode, 'publishable_key', v)} testid={`stripe-${mode}-pk`} />
      <Field label={k.secret_key_set ? `Secret key (${mode}) — ingesteld: ${k.secret_key_masked}` : `Secret key (${mode})`}
        type="password" mono value={keys[mode].secret_key} placeholder={k.secret_key_set ? 'Laat leeg om te behouden' : `sk_${mode}_...`}
        onChange={(v) => setK(mode, 'secret_key', v)} testid={`stripe-${mode}-sk`} />
      <Field label={k.webhook_secret_set ? `Webhook secret (${mode}) — ingesteld` : `Webhook secret (${mode})`}
        type="password" mono value={keys[mode].webhook_secret} placeholder={k.webhook_secret_set ? 'Laat leeg om te behouden' : 'whsec_...'}
        onChange={(v) => setK(mode, 'webhook_secret', v)} testid={`stripe-${mode}-whsec`}
        hint="Stripe Dashboard → Developers → Webhooks → endpoint toevoegen met events payment_intent.succeeded / payment_failed." />
      <div className="text-[11px] bg-slate-50 border border-slate-200 rounded-xl p-2.5">
        <p className="font-bold text-slate-600 mb-0.5">Webhook URL</p>
        <p className="font-mono text-slate-800 break-all" data-testid="stripe-webhook-url">{webhookUrl}</p>
      </div>
      {msg.text && (
        <div className={`rounded-xl p-2.5 text-xs flex items-center gap-2 border ${msg.type === 'ok'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`} data-testid="stripe-msg">
          {msg.type === 'ok' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />} {msg.text}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={test} disabled={!!busy} data-testid="stripe-test-btn"
          className="h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
          {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Test verbinding
        </button>
        <button type="button" onClick={save} disabled={!!busy} data-testid="stripe-save-btn"
          className="h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Stripe opslaan
        </button>
      </div>
    </Section>
  );
}

export default function SaasSettings() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // --- Mijn Account (superadmin login-gegevens) ---
  const [account, setAccount] = useState(null);
  const [accName, setAccName] = useState('');
  const [accEmail, setAccEmail] = useState('');
  const [accPassword, setAccPassword] = useState('');
  const [accSaving, setAccSaving] = useState(false);
  const [accError, setAccError] = useState('');
  const [accSuccess, setAccSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: r }, { data: acc }] = await Promise.all([
        api.get('/superadmin/settings'),
        api.get('/superadmin/account'),
      ]);
      setData(r);
      setAccount(acc);
      setAccName(acc.name || '');
      setAccEmail(acc.email || '');
    } catch (e) {
      setError(formatError(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      // Only send password/api_key fields if user actually typed something
      const payload = {
        banking: data.banking,
        branding: data.branding,
        fx: {
          mode: data.fx?.mode || 'auto',
          manual_eur_per_srd: Number(data.fx?.manual_eur_per_srd) || 0,
        },
        smtp: {
          enabled: data.smtp.enabled,
          host: data.smtp.host,
          port: data.smtp.port,
          username: data.smtp.username,
          from_name: data.smtp.from_name,
          from_email: data.smtp.from_email,
          use_tls: data.smtp.use_tls,
          ...(data.smtp.password ? { password: data.smtp.password } : {}),
        },
      };
      await api.put('/superadmin/settings', payload);
      setSuccess('Instellingen opgeslagen.');
      setTimeout(() => setSuccess(''), 3000);
      await load();
    } catch (e) {
      setError(formatError(e));
    } finally { setSaving(false); }
  };

  const testSmtp = async () => {
    setTesting(true); setError(''); setSuccess('');
    try {
      await api.post('/superadmin/settings/test-smtp');
      setSuccess('Test-mail verzonden! Controleer uw inbox.');
      setTimeout(() => setSuccess(''), 5000);
    } catch (e) {
      setError(formatError(e));
    } finally { setTesting(false); }
  };

  const saveAccount = async () => {
    setAccSaving(true); setAccError(''); setAccSuccess('');
    try {
      const payload = {};
      if (accName !== (account?.name || '')) payload.name = accName;
      if (accEmail.toLowerCase() !== (account?.email || '').toLowerCase()) {
        payload.email = accEmail;
      }
      if (accPassword) payload.password = accPassword;
      if (Object.keys(payload).length === 0) {
        setAccError('Geen wijzigingen om op te slaan.');
        setAccSaving(false);
        return;
      }
      const { data: r } = await api.put('/superadmin/account', payload);
      setAccPassword('');
      setAccount((prev) => ({
        ...prev,
        email: r.email,
        name: r.name,
        password_updated_at: r.password_updated_at,
      }));
      setAccSuccess('Account-instellingen opgeslagen.');
      setTimeout(() => setAccSuccess(''), 4000);
    } catch (e) {
      setAccError(formatError(e));
    } finally { setAccSaving(false); }
  };

  if (loading || !data) {
    return <div className="py-16 flex items-center justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;
  }

  const upd = (section, patch) => setData({ ...data, [section]: { ...data[section], ...patch } });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">SaaS Instellingen</h1>
          <p className="text-sm text-slate-500 mt-1">Banking, e-mail en platform-branding voor het hele SaaS systeem.</p>
        </div>
        <button onClick={save} disabled={saving} data-testid="saas-save"
          className="px-5 h-11 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-extrabold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-orange-500/25">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Opslaan
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm flex items-center gap-2" data-testid="saas-error">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-sm flex items-center gap-2" data-testid="saas-success">
          <Check className="w-4 h-4 shrink-0" /> {success}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Mijn Account" icon={UserCog} accent="bg-emerald-100 text-emerald-600">
          <p className="text-xs text-slate-500 -mt-1">
            Wijzig je eigen inlog e-mail en wachtwoord. Wijzigingen zijn direct actief.
          </p>
          <Field label="Naam" value={accName} placeholder="bv. Superadmin"
            onChange={setAccName} testid="acc-name" />
          <Field label="Inlog e-mailadres" type="email" value={accEmail}
            placeholder="bv. jij@bedrijf.sr"
            onChange={setAccEmail} testid="acc-email"
            hint="Dit is het adres waarmee je inlogt op het superadmin-portaal." />
          <Field label="Nieuw wachtwoord" type="password" value={accPassword}
            placeholder="Laat leeg om ongewijzigd te laten"
            onChange={setAccPassword} testid="acc-password"
            hint={account?.password_updated_at
              ? `Laatst gewijzigd: ${new Date(account.password_updated_at).toLocaleString('nl-NL')}`
              : 'Minstens 6 tekens.'} />
          {accError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-2.5 text-xs flex items-center gap-2" data-testid="acc-error">
              <AlertCircle className="w-4 h-4 shrink-0" /> {accError}
            </div>
          )}
          {accSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-2.5 text-xs flex items-center gap-2" data-testid="acc-success">
              <Check className="w-4 h-4 shrink-0" /> {accSuccess}
            </div>
          )}
          <button type="button" onClick={saveAccount} disabled={accSaving} data-testid="acc-save"
            className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {accSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Account opslaan
          </button>
        </Section>

        <Section title="Bankoverschrijving" icon={Landmark}>
          <Field label="Banknaam" value={data.banking?.bank_name} placeholder="bv. DSB Bank N.V."
            onChange={(v) => upd('banking', { bank_name: v })} testid="bank-name" />
          <Field label="Tenaamstelling" value={data.banking?.account_name} placeholder="bv. SuriRent N.V."
            onChange={(v) => upd('banking', { account_name: v })} testid="bank-account-name" />
          <Field label="Rekeningnummer" value={data.banking?.account_number} mono placeholder="bv. 12.34.56.789"
            onChange={(v) => upd('banking', { account_number: v })} testid="bank-account-number" />
          <Field label="SWIFT/BIC" value={data.banking?.swift} mono placeholder="bv. DSBBSRPA"
            onChange={(v) => upd('banking', { swift: v })} testid="bank-swift" />
          <Field label="Support e-mail" value={data.banking?.support_email} placeholder="billing@uwbedrijf.sr"
            onChange={(v) => upd('banking', { support_email: v })} testid="bank-support-email" />
          <Field label="WhatsApp" value={data.banking?.whatsapp} placeholder="+597 ..."
            onChange={(v) => upd('banking', { whatsapp: v })} testid="bank-whatsapp" />
        </Section>

        <StripeSection />

        <Section title="Wisselkoers SRD → EUR" icon={RefreshCw} accent="bg-amber-100 text-amber-600">
          <div className="flex gap-2">
            {['auto', 'manual'].map((m) => (
              <button key={m} type="button" onClick={() => upd('fx', { mode: m })}
                data-testid={`fx-mode-${m}`}
                className={`flex-1 h-11 rounded-xl font-bold text-sm transition ${
                  (data.fx?.mode || 'auto') === m ? 'bg-orange-500 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}>
                {m === 'auto' ? 'Automatisch (live)' : 'Handmatig'}
              </button>
            ))}
          </div>
          {(data.fx?.mode || 'auto') === 'auto' && (
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
              <p><strong>Live koers</strong> wordt elk 6 uur opgehaald van open.er-api.com (gratis).</p>
              {data.fx?.cached_rate > 0 && (
                <p>Laatst opgehaald: <span className="font-mono">1 SRD = €{Number(data.fx.cached_rate).toFixed(4)}</span>
                  {data.fx?.cached_at && <> · {new Date(data.fx.cached_at).toLocaleString('nl-NL')}</>}
                </p>
              )}
            </div>
          )}
          {(data.fx?.mode || 'auto') === 'manual' && (
            <Field label="Vaste koers — EUR per 1 SRD" type="number" mono
              value={data.fx?.manual_eur_per_srd || ''} placeholder="bv. 0.023"
              onChange={(v) => upd('fx', { manual_eur_per_srd: v })} testid="fx-manual-rate"
              hint="Wordt gebruikt voor EUR-equivalent op facturen. Sla op om te activeren." />
          )}
        </Section>

        <Section title="Platform e-mail (SMTP)" icon={Mail} accent="bg-blue-100 text-blue-600">
          <Toggle label="SMTP ingeschakeld" hint="Wordt gebruikt voor welkom-mails en facturen"
            value={data.smtp?.enabled} onChange={(v) => upd('smtp', { enabled: v })} testid="smtp-enabled" />
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Field label="SMTP Host" value={data.smtp?.host} placeholder="smtp.gmail.com"
                onChange={(v) => upd('smtp', { host: v })} testid="smtp-host" />
            </div>
            <Field label="Poort" type="number" value={data.smtp?.port}
              onChange={(v) => upd('smtp', { port: Number(v) || 587 })} testid="smtp-port" />
          </div>
          <Field label="Gebruikersnaam" value={data.smtp?.username}
            onChange={(v) => upd('smtp', { username: v })} testid="smtp-username" />
          <Field label={data.smtp?.password_set ? 'Wachtwoord (vervang om te wijzigen)' : 'Wachtwoord'} type="password"
            value={data.smtp?.password || ''} placeholder={data.smtp?.password_set ? '••••••••••••' : ''}
            onChange={(v) => upd('smtp', { password: v })} testid="smtp-password" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Afzender naam" value={data.smtp?.from_name}
              onChange={(v) => upd('smtp', { from_name: v })} testid="smtp-from-name" />
            <Field label="Afzender e-mail" value={data.smtp?.from_email} placeholder="no-reply@uwbedrijf.sr"
              onChange={(v) => upd('smtp', { from_email: v })} testid="smtp-from-email" />
          </div>
          <Toggle label="STARTTLS gebruiken" hint="Aanbevolen voor poort 587"
            value={data.smtp?.use_tls} onChange={(v) => upd('smtp', { use_tls: v })} testid="smtp-use-tls" />
          <button type="button" onClick={testSmtp} disabled={testing || !data.smtp?.enabled} data-testid="smtp-test"
            className="w-full h-11 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Verstuur test-mail naar mijzelf
          </button>
        </Section>

        <Section title="Platform branding" icon={Globe} accent="bg-purple-100 text-purple-600">
          <Field label="Platform naam" value={data.branding?.platform_name} placeholder="SuriRent"
            onChange={(v) => upd('branding', { platform_name: v })} testid="branding-name" />
          <Field label="App URL" value={data.branding?.app_url} placeholder="https://app.surirent.sr" mono
            onChange={(v) => upd('branding', { app_url: v })} testid="branding-app-url"
            hint="Gebruikt in welkom-mails en kwitanties. Override van APP_PUBLIC_URL env." />
        </Section>
      </div>
    </div>
  );
}
