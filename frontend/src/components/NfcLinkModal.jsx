import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Loader2, Nfc, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { subscribeNfc } from '../lib/nfc-bus';
import { FxStats, TenantPhoto } from './KioskFx';
import useVisualViewportPosition from '../lib/use-visual-viewport-position';

// Koppelscherm: onbekende NFC-tag → huurder kiezen → opslaan.
export function NfcLinkModal({ uid: initialUid, onLinked, onClose }) {
  const [uid, setUid] = useState(initialUid || '');
  const [apts, setApts] = useState(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [clash, setClash] = useState('');
  const sheetRef = useRef(null);
  useVisualViewportPosition(sheetRef);

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
    <div className="keyboard-opaque-backdrop fixed inset-0 z-[140] overflow-hidden bg-white sm:bg-black/50 sm:backdrop-blur-md flex flex-col sm:items-center sm:justify-center sm:p-4" data-testid="nfc-link-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="absolute inset-x-0 top-0 w-full h-full sm:static sm:inset-auto sm:h-auto sm:max-w-[42rem] sm:max-h-[90dvh] bg-white sm:rounded-3xl sm:shadow-2xl flex flex-col overflow-hidden">
        <div className="flex-none flex items-center justify-between gap-3 px-5 pb-4 bg-white border-b border-slate-100"
          style={{ paddingTop: 'max(var(--kiosk-sat, 0px), 16px)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-14 h-14 shrink-0 rounded-2xl bg-orange-100 flex items-center justify-center">
              <Nfc className="w-7 h-7 text-orange-600" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-black leading-tight text-slate-900">NFC-tag koppelen</h3>
              <p className="mt-1 text-sm leading-tight text-slate-500">Kies de huurder voor de gescande tag</p>
            </div>
          </div>
          <button onClick={onClose} data-testid="nfc-link-close" aria-label="Sluiten"
            className="w-14 h-14 shrink-0 rounded-2xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><X className="w-7 h-7 text-slate-700" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          <FxStats testId="nfc-fx-stats" items={[
            ['Huurders', apts ? apts.length : '…', 'orange'],
            ['Tag', uid ? 'Gescand' : 'Wachten…', uid ? 'green' : 'amber'],
            ['Gekozen', pick ? `${pick.number || '—'} · ${pick.tenant_name || 'Huurder'}` : '—', 'slate']]} />
          {uid ? (
            <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Gescande tag</div>
              <div className="text-base font-black text-slate-900 font-mono" data-testid="nfc-link-uid">{uid}</div>
              <div className="text-xs text-slate-500">
                {linkedTo ? <>Gekoppeld aan <b data-testid="nfc-link-linked-to">{linkedTo}</b> — kies een huurder om hem over te zetten.</> : 'Nog niet gekoppeld — kies de huurder.'}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-orange-50 border border-orange-100 px-4 py-4 text-base font-black text-[#FF5C00] flex items-center gap-3" data-testid="nfc-link-waiting">
              <Loader2 className="w-4 h-4 animate-spin" /> Houd de NFC-tag tegen de lezer…
            </div>
          )}
          <label className="flex items-center gap-3 h-14 rounded-2xl border-2 border-slate-200 px-4 focus-within:border-orange-500">
            <Search className="w-5 h-5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek huurder of appartement…" data-testid="nfc-link-search"
              className="flex-1 min-w-0 bg-transparent text-base font-semibold outline-none placeholder:text-slate-400" />
          </label>
          {apts === null ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-[#FF5C00] animate-spin" /></div> : (
            <div className="space-y-3" data-testid="nfc-link-tenants">
              {list.map((a) => {
                const on = pick?.id === a.id;
                return (
                  <button key={a.id} type="button" onClick={() => { setPick(a); setClash(''); }} data-testid={`nfc-link-tenant-${a.tenant_id}`}
                    className={`w-full text-left rounded-2xl border-2 px-4 py-4 flex items-center justify-between gap-3 transition-colors ${on ? 'border-[#FF5C00] bg-orange-50' : 'border-slate-200 hover:border-orange-300'}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <TenantPhoto tenantId={a.tenant_id} name={a.tenant_name}
                        photoUrl={a.tenant_avatar_url || a.tenant_id_photo_url} size={48} />
                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-900 truncate">{a.number || '—'}</div>
                        <div className="text-xs text-slate-500 truncate">{a.tenant_name || 'Onbekende huurder'}</div>
                      </div>
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
                className="h-14 px-5 rounded-2xl bg-amber-500 text-white font-black text-base">Ja, overzetten</button>
            </div>
          )}
          {err && <div className="rounded-xl text-sm font-semibold px-4 py-3 bg-red-50 border border-red-200 text-red-700" data-testid="nfc-link-error">{err}</div>}
        </div>
        <div className="flex-none px-5 py-3 border-t border-slate-100 bg-white grid grid-cols-2 gap-2"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
          <button onClick={() => save(false)} disabled={!uid || !pick || busy} data-testid="nfc-link-save"
            className="col-span-2 h-16 rounded-2xl bg-[#FF5C00] hover:bg-orange-600 text-white font-black text-lg inline-flex items-center justify-center gap-3 shadow-lg shadow-orange-200 disabled:opacity-40">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Nfc className="w-5 h-5" />} Koppeling opslaan
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
