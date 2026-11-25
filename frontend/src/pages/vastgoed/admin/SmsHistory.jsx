import { useCallback, useEffect, useState } from 'react';
import { api, formatError } from '../../../lib/api';

const LABELS = {
  sending: 'Bezig met verzenden',
  accepted: 'Aangenomen door Messente',
  status_unavailable: 'Afleverstatus niet beschikbaar',
  unconfirmed: 'Verzending niet bevestigd',
  ACK: 'Onderweg',
  ACCEPTD: 'Onderweg',
  DELIVRD: 'Afgeleverd',
  SEEN: 'Afgeleverd',
  UNDELIV: 'Niet afgeleverd',
  FAILED: 'Mislukt',
  REJECTD: 'Geweigerd',
  EXPIRED: 'Verlopen',
  NACK: 'Geweigerd',
  UNKNOWN: 'Status onbekend',
};

export default function SmsHistory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/sms/history');
      setItems(data);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4" data-testid="sms-history">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-black text-slate-900">SMS-status</h2>
        <button type="button" onClick={load} disabled={loading} className="rounded-xl bg-orange-50 px-4 py-2 font-bold text-[#FF5C00] disabled:opacity-50">Vernieuwen</button>
      </div>
      <p className="text-sm text-slate-500">De laatste 100 SMS-berichten van dit bedrijf. Alleen berichten vanaf de invoering van dit overzicht worden getoond.</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Laden…</p>}
      {!loading && !error && !items.length && <p className="text-sm text-slate-500">Nog geen SMS-berichten.</p>}
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${item.created_at}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-bold text-slate-900">{item.purpose}</span>
              <span className="font-bold text-slate-700">{LABELS[item.status] || 'Status onbekend'}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{item.to} · {new Date(item.created_at).toLocaleString('nl-NL')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
