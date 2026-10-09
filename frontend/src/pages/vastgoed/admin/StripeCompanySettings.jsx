import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Landmark, Check, AlertCircle, Loader2, Save, Zap } from 'lucide-react';
import { api, formatError } from '../../../lib/api';

const CARD = 'bg-white rounded-2xl border border-orange-100';

function KeyField({ label, value, onChange, placeholder, type = 'text', testid, hint }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">{label}</label>
      <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        data-testid={testid}
        className="w-full h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none font-mono text-sm" />
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function MethodToggle({ icon: Icon, label, sub, on, onChange, testid }) {
  return (
    <button type="button" onClick={() => onChange(!on)} data-testid={testid}
      className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-colors ${on ? 'border-[#FF5C00] bg-orange-50/50' : 'border-slate-200 hover:border-orange-200'}`}>
      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-400'}`}><Icon className="w-5 h-5" /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-black text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
      <span className={`relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-[#FF5C00]' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export default function StripeCompanySettings() {
  const [cfg, setCfg] = useState(null);
  const [mode, setMode] = useState('test');
  const [keys, setKeys] = useState({ test: {}, live: {} });
  const [methods, setMethods] = useState({ card: true, ideal: true });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });

  const load = useCallback(async () => {
    const { data } = await api.get('/company/stripe-config');
    setCfg(data); setMode(data.mode); setMethods({ card: data.card, ideal: data.ideal });
    setKeys({ test: { publishable_key: data.test.publishable_key }, live: { publishable_key: data.live.publishable_key } });
  }, []);
  useEffect(() => { load().catch((e) => setMsg({ type: 'err', text: formatError(e) })); }, [load]);

  const run = async (kind, fn, ok) => {
    setBusy(kind); setMsg({ type: '', text: '' });
    try { const r = await fn(); setMsg({ type: 'ok', text: ok(r) }); } catch (e) { setMsg({ type: 'err', text: formatError(e) }); } finally { setBusy(''); }
  };
  const save = () => run('save', async () => { await api.put('/company/stripe-config', { mode, ...keys, ...methods }); await load(); },
    () => 'Stripe-instellingen opgeslagen.');
  const test = () => run('test', () => api.post('/company/stripe-config/test'), ({ data }) => `Verbonden met ${data.name} (${data.mode === 'live' ? 'LIVE' : 'test'}).`);
  const setK = (f, v) => setKeys((k) => ({ ...k, [mode]: { ...k[mode], [f]: v } }));

  if (!cfg) return <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;
  const k = cfg[mode];
  return (
    <div className="space-y-4 max-w-4xl" data-testid="company-stripe-settings">
      <div className={`${CARD} px-5 py-4 flex items-center gap-3`} data-testid="company-stripe-status">
        <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${cfg.enabled ? 'bg-emerald-100 text-emerald-500' : 'bg-slate-100 text-slate-400'}`}>
          {cfg.enabled ? <Check className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
        </span>
        <div>
          <p className="text-sm font-black text-slate-900">{cfg.enabled ? `Actief in de Kiosk (${cfg.mode === 'live' ? 'LIVE' : 'testmodus'})` : 'Nog niet actief'}</p>
          <p className="text-xs text-slate-500">Huurders betalen via een QR-code op hun eigen telefoon of direct op het kiosk-scherm. Het geld komt op uw eigen Stripe-account.</p>
        </div>
      </div>

      <div className={`${CARD} p-5 space-y-3`}>
        <p className="text-sm font-black text-slate-900">Betaalmethodes in de Kiosk</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <MethodToggle icon={CreditCard} label="Creditcard" sub="Visa, Mastercard, Amex" on={methods.card}
            onChange={(v) => setMethods((m) => ({ ...m, card: v }))} testid="company-stripe-card-toggle" />
          <MethodToggle icon={Landmark} label="iDEAL" sub="Nederlandse banken" on={methods.ideal}
            onChange={(v) => setMethods((m) => ({ ...m, ideal: v }))} testid="company-stripe-ideal-toggle" />
        </div>
      </div>

      <div className={`${CARD} p-5 space-y-3`}>
        <div className="flex gap-2">
          {['test', 'live'].map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} data-testid={`company-stripe-mode-${m}`}
              className={`flex-1 h-11 rounded-xl font-bold text-sm transition-colors ${mode === m
                ? (m === 'live' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white') : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}>
              {m === 'live' ? 'Live (echte betalingen)' : 'Testmodus'}
            </button>
          ))}
        </div>
        <KeyField label={`Publishable key (${mode})`} value={keys[mode].publishable_key} placeholder={`pk_${mode}_...`}
          onChange={(v) => setK('publishable_key', v)} testid={`company-stripe-${mode}-pk`} />
        <KeyField label={k.secret_key_set ? `Secret key (${mode}) — ingesteld: ${k.secret_key_masked}` : `Secret key (${mode})`} type="password"
          value={keys[mode].secret_key} placeholder={k.secret_key_set ? 'Laat leeg om te behouden' : `sk_${mode}_...`}
          onChange={(v) => setK('secret_key', v)} testid={`company-stripe-${mode}-sk`}
          hint="Te vinden in Stripe Dashboard → Developers → API keys." />
        {msg.text && (
          <div className={`rounded-xl p-2.5 text-xs flex items-center gap-2 border ${msg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}
            data-testid="company-stripe-msg">
            {msg.type === 'ok' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />} {msg.text}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={test} disabled={!!busy} data-testid="company-stripe-test-btn"
            className="h-11 rounded-xl bg-white border-2 border-orange-200 hover:bg-orange-50 text-[#FF6A1A] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Test verbinding
          </button>
          <button type="button" onClick={save} disabled={!!busy} data-testid="company-stripe-save-btn"
            className="h-11 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 shadow-[0_10px_25px_-8px_rgba(255,92,0,0.5)]">
            {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}
