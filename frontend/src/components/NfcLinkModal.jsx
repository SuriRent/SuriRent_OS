import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Loader2, Nfc, Search, X } from 'lucide-react';
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

  const [linkedTo, setLinkedTo] = useState('');
  useEffect(() => subscribeNfc((id) => { setUid(id); setErr(''); setClash(''); }), []);
  // Gescande tag al gekoppeld? Toon aan wie (koppelen zet hem dan over).
  useEffect(() => {
    setLinkedTo('');
    if (!uid) return;
    api.post('/kiosk/nfc-lookup', { card_id: uid }).then(({ data }) => setLinkedTo(data?.found ? (data.tenant?.name || 'een huurder') : '')).catch(() => {});
  }, [uid]);
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
    <div className="fixed inset-0 z-[140] bg-white sm:bg-black/50 sm:backdrop-blur-md flex flex-col sm:items-center sm:justify-center sm:p-4" data-testid="nfc-link-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full h-full sm:h-auto sm:max-w-[42rem] sm:max-h-[90dvh] bg-white sm:rounded-2xl flex flex-col overflow-hidden">
        <div className="flex-none flex items-center justify-between px-4 sm:px-5 pb-3 bg-orange-500 sm:bg-white border-b border-orange-600 sm:border-slate-100"
          style={{ paddingTop: 'max(var(--kiosk-sat, 0px), 16px)' }}>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 sm:w-9 sm:h-9 rounded-xl sm:rounded-lg bg-white/20 sm:bg-orange-100 flex items-center justify-center">
              <Nfc className="w-5 h-5 text-white sm:text-orange-600" />
            </div>
            <h3 className="text-lg font-black text-white sm:text-slate-900">NFC-tag koppelen</h3>
          </div>
          <button onClick={onClose} data-testid="nfc-link-close" aria-label="Sluiten"
            className="w-10 h-10 rounded-xl text-white sm:text-slate-500 hover:bg-white/20 sm:hover:bg-slate-100 flex items-center justify-center"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-3">
          {uid ? (
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Gescande tag</div>
              <div className="text-base font-black text-slate-900 font-mono" data-testid="nfc-link-uid">{uid}</div>
              <div className="text-xs text-slate-500">
                {linkedTo ? <>Gekoppeld aan <b data-testid="nfc-link-linked-to">{linkedTo}</b> — kies een huurder om hem over te zetten.</> : 'Nog niet gekoppeld — kies de huurder.'}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-orange-50 px-4 py-3 text-sm font-black text-[#FF5C00] flex items-center gap-2" data-testid="nfc-link-waiting">
              <Loader2 className="w-4 h-4 animate-spin" /> Houd de NFC-tag tegen de lezer…
            </div>
          )}
          <label className="flex items-center gap-2 h-11 rounded-xl border border-slate-200 px-3">
            <Search className="w-4 h-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek huurder of appartement…" data-testid="nfc-link-search"
              className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
          </label>
          {apts === null ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-[#FF5C00] animate-spin" /></div> : (
            <div className="space-y-2" data-testid="nfc-link-tenants">
              {list.map((a) => {
                const on = pick?.id === a.id;
                return (
                  <button key={a.id} type="button" onClick={() => { setPick(a); setClash(''); }} data-testid={`nfc-link-tenant-${a.tenant_id}`}
                    className={`w-full text-left rounded-xl border px-4 py-3 flex items-center justify-between gap-3 transition-colors ${on ? 'border-[#FF5C00] bg-orange-50' : 'border-slate-200 hover:border-orange-300'}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-900 truncate">{a.tenant_name}</div>
                      <div className="text-xs text-slate-500 truncate">Appt. {a.number}</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {on && <span className="text-[11px] font-bold uppercase tracking-wide text-[#FF5C00]">Gekozen</span>}
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </button>
                );
              })}
              {!list.length && <div className="text-center text-slate-500 py-10 text-sm">Geen huurders gevonden.</div>}
            </div>
          )}
          {clash && (
            <div className="rounded-xl text-sm font-semibold px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 space-y-2" data-testid="nfc-link-clash">
              <p>{clash}. Wil je de tag overzetten naar {pick?.tenant_name}?</p>
              <button onClick={() => save(true)} disabled={busy} data-testid="nfc-link-replace"
                className="h-11 px-4 rounded-xl bg-amber-500 text-white font-black text-sm">Ja, overzetten</button>
            </div>
          )}
          {err && <div className="rounded-xl text-sm font-semibold px-4 py-3 bg-red-50 border border-red-200 text-red-700" data-testid="nfc-link-error">{err}</div>}
        </div>
        <div className="flex-none px-5 py-3 border-t border-slate-100 bg-white grid grid-cols-2 gap-2">
          <button onClick={() => save(false)} disabled={!uid || !pick || busy} data-testid="nfc-link-save"
            className="col-span-2 h-12 rounded-xl bg-[#FF5C00] text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Nfc className="w-4 h-4" />} Koppeling opslaan
          </button>
          <button onClick={onClose} data-testid="nfc-link-footer-close"
            className="col-span-2 h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">Sluiten</button>
        </div>
      </div>
    </div>
  ), document.body);
}
