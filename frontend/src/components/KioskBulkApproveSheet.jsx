import { useState } from 'react';
import { closeApprovalNotification } from '../lib/approval-notify-sync';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import KeyboardSafeModal from './KeyboardSafeModal';
import SignaturePad from './SignaturePad';
import { api, fmtMoney, formatError } from '../lib/api';

// Alle wachtende kiosk-betalingen van één medewerker met één handtekening goedkeuren.
export function KioskBulkApproveSheet({ logs, employeeName, onClose, onDone }) {
  const [sig, setSig] = useState('');
  const [hasSig, setHasSig] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [failed, setFailed] = useState([]);
  const [err, setErr] = useState('');
  const total = logs.reduce((s, l) => s + Number(l.payment.amount || 0), 0);
  const currency = logs[0]?.payment.currency || 'SRD';

  const submit = async () => {
    if (!hasSig) { setErr('Teken eerst uw handtekening'); return; }
    setErr(''); setFailed([]);
    const bad = [];
    // Na elkaar: elke goedkeuring koppelt facturen (FIFO) — parallel zou kunnen botsen.
    for (let i = 0; i < logs.length; i += 1) {
      setProgress({ done: i, total: logs.length });
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.post(`/payments/${logs[i].payment_id}/approve`, { signature_data_url: sig });
        closeApprovalNotification(logs[i].payment_id);
      } catch (e) { bad.push(`${logs[i].payment.receipt_number}: ${formatError(e)}`); }
    }
    setProgress(null);
    if (bad.length) { setFailed(bad); onDone(false); } else { onDone(true); }
  };

  const busy = !!progress;
  return (
    <KeyboardSafeModal onClose={busy ? () => {} : onClose} testId="bulk-approve-modal" className="!z-[10050]">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">Alles goedkeuren</h3>
          <button onClick={onClose} disabled={busy} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3.5 mb-4 text-[13px]">
          <p className="font-bold text-slate-900">{logs.length} betaling{logs.length === 1 ? '' : 'en'} van {employeeName}</p>
          <p className="text-slate-500">Totaal <span className="font-black text-slate-900" data-testid="bulk-approve-total">{fmtMoney(total, currency)}</span></p>
          <ul className="mt-2 max-h-36 overflow-y-auto space-y-1">
            {logs.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 text-slate-600">
                <span className="truncate">{l.payment.tenant_name || 'Huurder'} · {l.payment.receipt_number}</span>
                <span className="font-bold whitespace-nowrap">{fmtMoney(l.payment.amount, l.payment.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Uw handtekening</p>
        <SignaturePad onChange={(url, has) => { setSig(url); setHasSig(has); }} height={170} />
        {err && <p className="text-sm text-red-600 font-semibold mt-2" data-testid="bulk-approve-error">{err}</p>}
        {failed.length > 0 && (
          <div className="mt-2 text-xs text-red-600 font-semibold space-y-0.5" data-testid="bulk-approve-failed">
            <p>Niet gelukt:</p>{failed.map((f) => <p key={f}>{f}</p>)}
          </div>
        )}
        <button onClick={submit} disabled={busy} data-testid="bulk-approve-submit"
          className="mt-4 w-full h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-70">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {progress.done + 1} / {progress.total} goedkeuren…</>
            : <><CheckCircle2 className="w-4 h-4" /> {logs.length} goedkeuren</>}
        </button>
      </KeyboardSafeModal.Body>
    </KeyboardSafeModal>
  );
}
