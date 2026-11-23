import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Check, Loader2, Save, Wallet, Zap } from 'lucide-react';
import { api, formatError } from '../../../lib/api';

export default function MopeCompanySettings() {
  const [config, setConfig] = useState(null);
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ type: '', text: '' });

  const load = useCallback(async () => {
    const { data } = await api.get('/company/mope-config');
    setConfig(data);
    setEnabled(data.enabled);
  }, []);

  useEffect(() => {
    load().catch((error) => setMessage({ type: 'err', text: formatError(error) }));
  }, [load]);

  const run = async (kind, action) => {
    setBusy(kind);
    setMessage({ type: '', text: '' });
    try {
      const result = await action();
      setMessage({ type: 'ok', text: result || 'Mopé-instellingen opgeslagen.' });
    } catch (error) {
      setMessage({ type: 'err', text: formatError(error) });
    } finally {
      setBusy('');
    }
  };

  const save = () => run('save', async () => {
    await api.put('/company/mope-config', { api_token: token, enabled });
    setToken('');
    await load();
    return 'Mopé-instellingen opgeslagen.';
  });

  const test = () => run('test', async () => {
    const { data } = await api.post('/company/mope-config/test');
    return data.message;
  });

  if (!config) return <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;

  return (
    <div className="space-y-4 max-w-4xl" data-testid="company-mope-settings">
      <div className="bg-white rounded-2xl border border-orange-100 px-5 py-4 flex items-center gap-3">
        <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${config.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
          {config.enabled ? <Check className="w-5 h-5" /> : <Wallet className="w-5 h-5" />}
        </span>
        <div>
          <p className="text-sm font-black text-slate-900">{config.enabled ? 'Mopé is actief in beide kiosks' : 'Mopé is nog niet actief'}</p>
          <p className="text-xs text-slate-500">Betalingen worden rechtstreeks op uw eigen Mopé-webshopaccount ontvangen.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-orange-100 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-black text-slate-900">Koppel uw Mopé-webshop</h2>
          <p className="text-xs text-slate-500 mt-1">
            Gebruik het API-token van uw gevalideerde Mopé-account met webshopfunctionaliteit. SuriRent bewaart het token beveiligd op de server en toont het hier niet opnieuw.
          </p>
        </div>
        <div>
          <label htmlFor="mope-api-token" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Mopé API-token</label>
          <input id="mope-api-token" type="password" autoComplete="new-password" value={token}
            onChange={(event) => setToken(event.target.value)} placeholder={config.token_set ? `Ingesteld: ${config.token_masked} — leeg laten om te behouden` : 'Plak uw Mopé API-token'}
            data-testid="company-mope-token"
            className="w-full h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none font-mono text-sm" />
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)}
            data-testid="company-mope-enabled" className="w-5 h-5 accent-[#FF5C00]" />
          <span>
            <span className="block text-sm font-bold text-slate-900">Mopé-betalingen inschakelen</span>
            <span className="block text-xs text-slate-500">Toon Mopé als betaalmethode in de operator- en huurderskiosk.</span>
          </span>
        </label>
        {message.text && (
          <div className={`rounded-xl p-3 text-xs flex items-center gap-2 border ${message.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}
            data-testid="company-mope-message">
            {message.type === 'ok' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />} {message.text}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-2">
          <button type="button" onClick={test} disabled={!!busy || !config.token_set}
            data-testid="company-mope-test"
            className="h-11 rounded-xl bg-white border-2 border-orange-200 hover:bg-orange-50 text-[#FF6A1A] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Test verbinding
          </button>
          <button type="button" onClick={save} disabled={!!busy}
            data-testid="company-mope-save"
            className="h-11 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}
