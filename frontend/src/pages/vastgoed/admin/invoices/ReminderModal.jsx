import { useState } from 'react';
import { X, Check, Loader2, MessageCircle, Mail } from 'lucide-react';
import { api, formatError, fmtMoney } from '../../../../lib/api';
import KeyboardSafeModal from '../../../../components/KeyboardSafeModal';

// =====================================================================
// Reminder modal — WhatsApp / SMS / E-mail betalingsherinnering
// =====================================================================
export default function ReminderModal({ group, initialChannel = 'whatsapp', onClose, onSent }) {
  const [channel, setChannel] = useState(initialChannel);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setLoading(true); setError('');
    try {
      await api.post(`/tenants/${group.tenant_id}/reminder`, { channel, message });
      onSent(channel);
    } catch (e) { setError(formatError(e)); }
    finally { setLoading(false); }
  };

  const channels = [
    { v: 'whatsapp', l: 'WhatsApp', icon: MessageCircle, color: 'emerald' },
    { v: 'sms', l: 'SMS', icon: MessageCircle, color: 'slate' },
    { v: 'email', l: 'E-mail', icon: Mail, color: 'orange' },
  ];

  return (
    <KeyboardSafeModal onClose={onClose} testId="reminder-modal">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xl font-black text-slate-900">Betalingsherinnering</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-slate-500">Naar <b className="text-slate-900">{group.tenant_name}</b> · {group.openCount} openstaande maand{group.openCount !== 1 ? 'en' : ''} · {fmtMoney(group.totalOpen, group.currency)}</p>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        {error && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{error}</div>}

        <div className="space-y-3 mb-4">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Kanaal</label>
          <div className="grid grid-cols-3 gap-2">
            {channels.map((c) => {
              const sel = channel === c.v;
              return (
                <button key={c.v} onClick={() => setChannel(c.v)}
                  data-testid={`reminder-channel-${c.v}`}
                  className={`py-3 rounded-xl border-2 font-bold text-sm flex flex-col items-center gap-1 transition ${
                    sel ? 'border-[#FF5C00] bg-orange-50 text-[#FF5C00]' : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300'
                  }`}>
                  <c.icon className="w-4 h-4" /> {c.l}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Toon (optioneel)</label>
          <p className="text-[11px] text-slate-500">Kies een voorbeeldbericht — geen typen nodig.</p>
          <div className="grid grid-cols-1 gap-2">
            {[
              { key: 'friendly', label: 'Vriendelijk', text: 'Vriendelijke herinnering — u heeft nog openstaande huur. Kunnen we deze week de betaling verwachten?' },
              { key: 'reminder', label: 'Herinnering', text: 'Wij zien dat de huur nog niet is voldaan. Graag zo snel mogelijk overmaken zodat we geen extra kosten in rekening hoeven te brengen.' },
              { key: 'urgent', label: 'Dringend', text: 'LAATSTE HERINNERING: de huur is meerdere maanden achterstallig. Neem direct contact op om verdere stappen te voorkomen.' },
              { key: 'none', label: 'Geen extra bericht', text: '' },
            ].map((opt) => {
              const sel = message === opt.text;
              return (
                <button key={opt.key} type="button" onClick={() => setMessage(opt.text)}
                  data-testid={`reminder-tone-${opt.key}`}
                  className={`text-left p-3 rounded-xl border-2 transition ${
                    sel ? 'border-[#FF5C00] bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-300'
                  }`}>
                  <p className={`text-xs font-black uppercase tracking-wider mb-0.5 ${sel ? 'text-[#FF5C00]' : 'text-slate-700'}`}>{opt.label}</p>
                  {opt.text && <p className="text-[11px] text-slate-600 leading-snug">{opt.text}</p>}
                </button>
              );
            })}
          </div>
        </div>
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-3">
        <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
        <button onClick={send} disabled={loading} data-testid="reminder-send"
          className="flex-1 h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Versturen
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}
