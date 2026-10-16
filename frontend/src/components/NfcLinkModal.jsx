import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Nfc, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { subscribeNfc } from '../lib/nfc-bus';

// Koppelscherm: onbekende NFC-tag → huurder kiezen → opslaan.
export function NfcLinkModal({ uid: initialUid, onLinked, onClose }) {
  const [uid, setUid] = useState(initialUid || '');
  const [apts, setApts] = useState(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [clash, setClash] = useState('');

  useEffect(() => subscribeNfc((id) => { setUid(id); setErr(''); setClash(''); }), []);
  useEffect(() => {
    api.get('/kiosk/apartments').then(({ data }) => setApts((data || []).filter((a) => a.tenant_id))).catch(() => setApts([]));
  }, []);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (apts || []).filter((a) => !n || `${a.tenant_name || ''} ${a.number || ''}`.toLowerCase().includes(n)).slice(0, 60);
  }, [apts, q]);

  const save = async (replace = false) => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/kiosk/nfc-link', { card_id: uid, tenant_id: pick.tenant_id, replace });
      onLinked(data);
    } catch (e) {
      if (e?.response?.status === 409) setClash(e.response.data?.detail || 'Tag al gekoppeld');
      else setErr(e?.response?.data?.detail || 'Opslaan mislukt');
    } finally { setBusy(false); }
  };

  return createPortal((
    <div className="fixed inset-0 z-[140] bg-black/50 flex items-end sm:items-center justify-center p-3" data-testid="nfc-link-modal">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <p className="font-black text-slate-900 flex items-center gap-2"><Nfc className="w-5 h-5 text-[#FF5C00]" /> NFC-tag koppelen</p>
          <button onClick={onClose} data-testid="nfc-link-close" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {uid ? (
            <p className="text-sm text-slate-600">Tag <span className="font-mono font-bold text-slate-900" data-testid="nfc-link-uid">{uid}</span> is nog niet gekoppeld. Kies de huurder:</p>
          ) : (
            <p className="text-sm font-bold text-[#FF5C00] bg-orange-50 rounded-xl px-3 py-3 flex items-center gap-2" data-testid="nfc-link-waiting">
              <Loader2 className="w-4 h-4 animate-spin" /> Houd de NFC-tag tegen de lezer…
            </p>
          )}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek huurder of appartement" data-testid="nfc-link-search"
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#FF5C00]" />
          </div>
          {apts === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : (
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl max-h-64 overflow-y-auto" data-testid="nfc-link-tenants">
              {list.map((a) => (
                <li key={a.id}>
                  <button onClick={() => { setPick(a); setClash(''); }} data-testid={`nfc-link-tenant-${a.tenant_id}`}
                    className={`w-full text-left px-3 py-2.5 text-sm flex justify-between gap-2 ${pick?.id === a.id ? 'bg-orange-50 font-bold text-[#FF5C00]' : 'hover:bg-slate-50 text-slate-800'}`}>
                    <span className="truncate">{a.tenant_name}</span><span className="text-slate-400 shrink-0">App. {a.number}</span>
                  </button>
                </li>
              ))}
              {!list.length && <li className="px-3 py-3 text-sm text-slate-400">Geen huurders gevonden</li>}
            </ul>
          )}
          {clash && (
            <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 space-y-2" data-testid="nfc-link-clash">
              <p>{clash}. Wil je de tag overzetten naar {pick?.tenant_name}?</p>
              <button onClick={() => save(true)} disabled={busy} data-testid="nfc-link-replace"
                className="h-9 px-3 rounded-lg bg-amber-500 text-white font-bold text-xs">Ja, overzetten</button>
            </div>
          )}
          {err && <p className="text-sm text-red-600" data-testid="nfc-link-error">{err}</p>}
        </div>
        <div className="p-4 border-t border-slate-100">
          <button onClick={() => save(false)} disabled={!uid || !pick || busy} data-testid="nfc-link-save"
            className="w-full h-12 rounded-xl bg-[#FF5C00] hover:bg-orange-600 text-white font-black disabled:opacity-40 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Koppeling opslaan
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
