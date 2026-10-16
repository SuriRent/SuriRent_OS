import { useState } from 'react';
import { Check, Loader2, Nfc, Pencil, Trash2, X } from 'lucide-react';
import { api, formatError } from '../lib/api';

// Beheer: NFC-tag van een huurder bekijken, wijzigen en verwijderen.
export function TenantNfcCard({ tenant, onReload }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const tag = tenant.nfc_card_id;

  const save = async (card_id) => {
    setBusy(true); setErr('');
    try {
      await api.put(`/admin/tenants/${tenant.id}/nfc-card`, { card_id });
      setEditing(false);
      if (onReload) await onReload();
    } catch (e) { setErr(formatError(e)); } finally { setBusy(false); }
  };
  const remove = () => { if (window.confirm('NFC-koppeling verwijderen? De tag opent deze huurder dan niet meer op de kiosk.')) save(''); };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5" data-testid="tenant-nfc-card">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">NFC-tag</p>
      {editing ? (
        <div className="flex flex-wrap gap-2">
          <input value={val} onChange={(e) => setVal(e.target.value.toUpperCase())} placeholder="Tag-ID, bijv. 04A1B2C3D4" autoFocus
            data-testid="tenant-nfc-input" className="flex-1 min-w-[180px] h-11 px-3 rounded-xl border border-slate-200 font-mono text-sm focus:outline-none focus:border-[#FF5C00]" />
          <button onClick={() => save(val)} disabled={busy || val.replace(/[^A-Z0-9]/g, '').length < 4} data-testid="tenant-nfc-save"
            className="h-11 px-4 rounded-xl bg-[#FF5C00] text-white font-bold text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Opslaan
          </button>
          <button onClick={() => { setEditing(false); setErr(''); }} data-testid="tenant-nfc-cancel"
            className="h-11 w-11 rounded-xl border border-slate-200 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${tag ? 'bg-orange-50 text-[#FF5C00]' : 'bg-slate-100 text-slate-400'}`}><Nfc className="w-5 h-5" /></span>
          <span className="flex-1 min-w-0">
            {tag ? <span className="font-mono font-bold text-slate-900" data-testid="tenant-nfc-value">{tag}</span>
              : <span className="text-sm text-slate-400" data-testid="tenant-nfc-empty">Geen tag gekoppeld — koppel op de kiosk via Snel toevoegen → NFC-tag koppelen</span>}
          </span>
          <button onClick={() => { setVal(tag || ''); setEditing(true); }} data-testid="tenant-nfc-edit" title={tag ? 'Wijzigen' : 'Toevoegen'}
            className="h-9 w-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center"><Pencil className="w-4 h-4" /></button>
          {tag && (
            <button onClick={remove} disabled={busy} data-testid="tenant-nfc-delete" title="Verwijderen"
              className="h-9 w-9 rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
          )}
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-600" data-testid="tenant-nfc-error">{err}</p>}
    </div>
  );
}
