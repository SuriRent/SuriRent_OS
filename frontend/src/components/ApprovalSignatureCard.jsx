import { useEffect, useState } from 'react';
import { Check, Loader2, PenLine, Trash2 } from 'lucide-react';
import { api, formatError } from '../lib/api';
import SignaturePad from './SignaturePad';

// Opgeslagen handtekening voor "Goedkeuren" direct vanuit een melding.
export function ApprovalSignatureCard() {
  const [saved, setSaved] = useState(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ url: '', has: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/me/approval-signature').then(({ data }) => setSaved(data.signature_data_url || null)).catch(() => setSaved(null));
  }, []);

  const save = async (url) => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.put('/me/approval-signature', { signature_data_url: url });
      setSaved(data.signature_data_url || null); setEditing(false);
    } catch (e) { setErr(formatError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 bg-white border border-orange-100 rounded-2xl p-6 space-y-3" data-testid="approval-signature-section">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-50 text-[#FF5C00] flex items-center justify-center"><PenLine className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="font-black text-slate-900">Goedkeuren vanuit melding</h3>
          <p className="text-xs text-slate-500">Meldingen voor goedkeuring krijgen de knoppen Goedkeuren en Afwijzen. Je opgeslagen handtekening wordt dan gebruikt; zonder handtekening staat op de kwitantie "(via melding)".</p>
        </div>
      </div>
      {saved === undefined ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : editing ? (
        <div className="space-y-2">
          <SignaturePad onChange={(url, has) => setDraft({ url, has })} height={150} />
          <div className="flex gap-2">
            <button onClick={() => save(draft.url)} disabled={!draft.has || busy} data-testid="approval-signature-save"
              className="h-10 px-4 rounded-xl bg-[#FF5C00] hover:bg-orange-600 text-white font-bold text-sm inline-flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Opslaan
            </button>
            <button onClick={() => setEditing(false)} data-testid="approval-signature-cancel"
              className="h-10 px-4 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm">Annuleren</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {saved
            ? <img src={saved} alt="Handtekening" className="h-16 border border-slate-100 rounded-lg bg-white" data-testid="approval-signature-preview" />
            : <p className="text-sm text-slate-400 flex-1" data-testid="approval-signature-empty">Nog geen handtekening opgeslagen.</p>}
          <div className="flex gap-2 ml-auto">
            <button onClick={() => setEditing(true)} data-testid="approval-signature-edit"
              className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm">{saved ? 'Wijzigen' : 'Handtekening zetten'}</button>
            {saved && (
              <button onClick={() => save(null)} disabled={busy} title="Verwijderen" data-testid="approval-signature-delete"
                className="h-10 w-10 rounded-xl border border-slate-200 text-red-500 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        </div>
      )}
      {err && <p className="text-sm text-red-600" data-testid="approval-signature-error">{err}</p>}
    </div>
  );
}
