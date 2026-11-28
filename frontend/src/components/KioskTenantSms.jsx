import { useEffect, useState } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import { api, formatError, fmtMoney } from '../lib/api';

const GSM_BASIC = new Set(Array.from(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
));
const GSM_EXTENDED = new Set(Array.from('\f^{}\\[~]|€'));

export function smsLength(text) {
  const chars = Array.from(text);
  const gsm = chars.every((char) => GSM_BASIC.has(char) || GSM_EXTENDED.has(char));
  return {
    length: gsm ? chars.reduce((total, char) => total + (GSM_EXTENDED.has(char) ? 2 : 1), 0) : text.length,
    limit: gsm ? 160 : 70,
  };
}

const actions = [
  ['message', 'Zelf typen'],
  ['invoice', 'Factuur'],
  ['receipt', 'Betaalbewijs'],
  ['reminder', 'Herinnering'],
  ['signature', 'Handtekening'],
];

export default function KioskTenantSms({ apartment, onClose, Shell }) {
  const [data, setData] = useState(null);
  const [action, setAction] = useState('message');
  const [documentId, setDocumentId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    api.get(`/kiosk/tenants/${apartment.tenant_id}/sms`)
      .then(({ data: result }) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(formatError(err)); });
    return () => { active = false; };
  }, [apartment.tenant_id]);

  const count = smsLength(message);
  const documents = action === 'invoice' ? data?.invoices : data?.payments;
  const needsDocument = action === 'invoice' || action === 'receipt';
  const canSend = Boolean(data?.tenant?.phone) && !sending
    && (!needsDocument || !!documentId)
    && (action !== 'message' || (!!message.trim() && count.length <= count.limit));

  const send = async () => {
    setSending(true);
    setError('');
    setSent('');
    try {
      await api.post(`/kiosk/tenants/${apartment.tenant_id}/sms`, {
        action, document_id: needsDocument ? documentId : null,
        message: action === 'message' ? message : '',
      });
      setSent('SMS aangenomen door Messente. De aflevering is nog niet bevestigd.');
      if (action === 'message') setMessage('');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Shell title="SMS" subtitle={`Appartement ${apartment.number}`} Icon={MessageCircle}
      testId="tenant-sms" onClose={onClose} tall>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {sent && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{sent}</p>}
      {!data && !error && <div className="flex justify-center py-8"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>}
      {data && (
        <div className="space-y-4">
          <p className="text-sm font-bold text-slate-900">{data.tenant.name} · {data.tenant.phone || 'Geen telefoonnummer'}</p>
          {!data.tenant.phone && <p className="text-sm text-red-700">Voeg eerst een telefoonnummer toe aan de huurder.</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Soort SMS">
            {actions.map(([value, label]) => (
              <button key={value} type="button" disabled={sending} onClick={() => { setAction(value); setDocumentId(''); setError(''); setSent(''); }}
                aria-pressed={action === value} data-testid={`tenant-sms-action-${value}`}
                className={`min-h-11 rounded-xl border-2 px-2 text-sm font-bold ${action === value ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
          {action === 'message' && (
            <div>
              <label htmlFor="tenant-sms-message" className="block text-sm font-bold text-slate-700">Bericht</label>
              <textarea id="tenant-sms-message" disabled={sending} value={message} onChange={(event) => setMessage(event.target.value)}
                rows={5} className="mt-1 w-full rounded-xl border-2 border-slate-200 p-3 text-base outline-none focus:border-orange-500" />
              <p className={`text-sm ${count.length > count.limit ? 'text-red-700' : 'text-slate-500'}`}>
                {count.length}/{count.limit} voor één SMS{count.limit === 70 ? ' (Unicode)' : ''}
              </p>
            </div>
          )}
          {needsDocument && (
            <div>
              <label htmlFor="tenant-sms-document" className="block text-sm font-bold text-slate-700">
                Kies {action === 'invoice' ? 'een factuur' : 'een betaalbewijs'}
              </label>
              <select id="tenant-sms-document" disabled={sending} value={documentId} onChange={(event) => setDocumentId(event.target.value)}
                className="mt-1 h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base">
                <option value="">Selecteer...</option>
                {(documents || []).map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.invoice_number || doc.receipt_number} · {fmtMoney(Number(doc.amount || 0), doc.currency || 'SRD')}
                  </option>
                ))}
              </select>
              {!documents?.length && <p className="mt-1 text-sm text-slate-500">Geen documenten beschikbaar.</p>}
              <p className="mt-1 text-sm text-slate-500">De link blijft 30 dagen geldig.</p>
            </div>
          )}
          {action === 'reminder' && <p className="text-sm text-slate-600">Verstuur een herinnering voor de openstaande facturen.</p>}
          {action === 'signature' && <p className="text-sm text-slate-600">Verstuur een eenmalige handtekeninglink die 24 uur geldig is.</p>}
          <button type="button" onClick={send} disabled={!canSend} data-testid="tenant-sms-send"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 font-bold text-white disabled:opacity-50">
            {sending && <Loader2 className="h-4 w-4 animate-spin" />} SMS versturen
          </button>
        </div>
      )}
    </Shell>
  );
}
