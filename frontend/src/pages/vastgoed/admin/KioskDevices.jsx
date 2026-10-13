import { useCallback, useEffect, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { api, formatError } from '../../../lib/api';
import { useAutoRefresh } from '../../../lib/auto-refresh';

export default function KioskDevices() {
  const [on, setOn] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/settings');
      setOn(!!data?.kiosk_devices?.kt_v520_enabled);
    } catch (e) { setErr(formatError(e)); setOn((o) => o ?? false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const toggle = async (v) => {
    setSaving(true); setOn(v); setErr('');
    try {
      await api.put('/settings/kiosk_devices', { kt_v520_enabled: v });
    } catch (e) { setOn(!v); setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  if (on === null) {
    return <div className="flex items-center text-slate-400 text-sm p-10"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Laden...</div>;
  }
  return (
    <div className="bg-white rounded-2xl border border-orange-100 p-5 space-y-4" data-testid="kiosk-devices">
      <div className="flex items-start gap-4">
        <span className="w-12 h-12 rounded-xl bg-orange-50 text-[#FF5C00] flex items-center justify-center shrink-0"><Printer className="w-6 h-6" /></span>
        <div className="flex-1 min-w-0">
          <p className="font-black text-slate-900">KingTop KT-V520 printer</p>
          <p className="text-sm text-slate-500 mt-0.5">
            Alle kiosks printen bonnen via de ingebouwde KT-V520 printer (KTPsdk) als tekstregels. Uit = printen zoals nu.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {saving && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          <button type="button" role="switch" aria-checked={on} onClick={() => toggle(!on)} disabled={saving}
            data-testid="kiosk-devices-kt-v520-switch"
            className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>
      <p className={`text-xs font-bold ${on ? 'text-emerald-600' : 'text-slate-400'}`} data-testid="kiosk-devices-kt-v520-status">
        {on ? 'Ingeschakeld — kiosks krijgen dit direct door via de live-verbinding.' : 'Uitgeschakeld'}
      </p>
      {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2" data-testid="kiosk-devices-error">{err}</p>}
      <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 leading-relaxed">
        Werkt alleen in de Android kiosk-app met de KTPsdk.aar ingebouwd. In de browser verandert er niets.
      </p>
    </div>
  );
}
