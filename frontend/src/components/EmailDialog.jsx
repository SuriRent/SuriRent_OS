import { useState } from 'react';
import { Mail, X, Loader2, Send, AlertCircle, Check, MessageCircle } from 'lucide-react';
import { api, formatError } from '../lib/api';
import { openWhatsApp } from '../lib/external-link';

/**
 * SendDialog — E-mail-only versie (WhatsApp/SMS tabs verwijderd op verzoek
 * gebruiker feb 2026). Bovenaan zit een grote "Verzenden per e-mail" knop
 * en onderaan een aparte "Open WhatsApp met huurder"-knop die via de Web
 * Share API de bijbehorende JPG-foto (voor payments) direct als bijlage
 * naar WhatsApp stuurt. Bij overige document-types valt hij terug op de
 * wa.me deeplink met PDF-link.
 *
 * Props:
 *  - documentType: 'payment' | 'invoice' | 'contract' | 'overdue-reminder'
 *  - documentId
 *  - documentLabel: e.g. "kwitantie", "factuur"
 *  - title
 *  - tenantEmail / tenantPhone / tenantName
 *  - onClose, onSent
 */
export function SendDialog({
  documentType, documentId, documentLabel, title,
  tenantEmail = '', tenantPhone = '', tenantName = '',
  // availableChannels genegeerd — enkel e-mail + WhatsApp-deeplink onderaan
  onClose, onSent,
}) {
  const [to, setTo] = useState(tenantEmail);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [waSharing, setWaSharing] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const validateEmail = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setErr('Voer een geldig e-mailadres in');
      return false;
    }
    return true;
  };

  const send = async () => {
    setErr(''); setOk('');
    if (!validateEmail()) return;
    setSending(true);
    try {
      const { data } = await api.post(
        `/email/${documentType}/${documentId}`,
        { to: to.trim(), message: msg.trim() },
      );
      setOk(`Verzonden naar ${data.sent_to} via e-mail`);
      if (onSent) onSent(data);
      setTimeout(() => onClose?.(), 1500);
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setSending(false);
    }
  };

  // Voor payments én overdue-reminders bestaat een JPG-endpoint dat via
  // Web Share API als foto-bijlage naar WhatsApp gestuurd kan worden.
  const imageEndpoint = (() => {
    if (documentType === 'payment') return `/api/payments/${documentId}/image`;
    if (documentType === 'overdue-reminder') return `/api/tenants/${documentId}/reminder-image`;
    return null;
  })();

  const openWa = async () => {
    if (!tenantPhone) return;
    const phone = tenantPhone.replace(/\D/g, '');
    if (!phone) return;
    const greeting = `Beste ${tenantName || 'huurder'},`;
    const intro = msg.trim() || `Hierbij uw ${documentLabel}.`;
    // Probeer eerst Web Share met JPG-bijlage — huurder ziet dan de foto
    // direct in de chat, niet als link (gevraagd door gebruiker).
    if (imageEndpoint) {
      setWaSharing(true);
      try {
        const resp = await fetch(`${process.env.REACT_APP_BACKEND_URL}${imageEndpoint}`);
        if (resp.ok) {
          const blob = await resp.blob();
          const file = new File([blob], `${documentLabel}-${documentId.slice(0, 8)}.jpg`, { type: 'image/jpeg' });
          const shareText = `${greeting}\n\n${intro}`;
          if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text: shareText, title });
            setWaSharing(false);
            return;
          }
        }
      } catch (e) {
        if (e && e.name === 'AbortError') { setWaSharing(false); return; }
        // eslint-disable-next-line no-console
        console.warn('[SendDialog] share fout, fallback wa.me', e);
      }
      setWaSharing(false);
    }
    // Fallback: wa.me deeplink met PDF-link
    const apiBase = `${process.env.REACT_APP_BACKEND_URL}/api`;
    const pdfUrl = `${apiBase}/${documentType === 'overdue-reminder' ? 'tenants' : documentType + 's'}/${documentId}/pdf`;
    const fullMsg = `${greeting}\n\n${intro}\n\n${pdfUrl}\n\nMet vriendelijke groet,\nSuriRent`;
    openWhatsApp(phone, fullMsg);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" data-testid="send-dialog">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#FF8A3D] to-[#C74600] flex items-center justify-center">
              <Send className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black text-slate-900 leading-tight truncate">{title}</h2>
              {tenantName && <p className="text-[11px] text-slate-500 truncate">Voor: {tenantName}</p>}
            </div>
          </div>
          <button onClick={onClose} data-testid="send-dialog-close"
            className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center shrink-0">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Ontvanger e-mail</label>
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)}
              placeholder="huurder@voorbeeld.com"
              data-testid="send-to"
              className="w-full mt-1 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            {!tenantEmail && (
              <p className="text-[11px] text-amber-700 mt-1">
                ⚠️ Huurder heeft geen e-mailadres in profiel — voer handmatig in.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Extra bericht (optioneel)</label>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3}
              data-testid="send-msg"
              placeholder={`Bijvoorbeeld: "Hierbij je ${documentLabel} voor deze maand."`}
              className="w-full mt-1 px-3 py-2 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none resize-none" />
          </div>
          {err && (
            <div className="flex gap-2 items-start text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {err}
            </div>
          )}
          {ok && (
            <div className="flex gap-2 items-start text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              <Check className="w-4 h-4 mt-0.5 shrink-0" /> {ok}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} data-testid="send-cancel"
              className="flex-1 h-11 rounded-xl border-2 border-slate-200 text-slate-700 font-bold hover:bg-slate-50">
              Annuleren
            </button>
            <button onClick={send} disabled={sending || !to} data-testid="send-submit"
              className="flex-1 h-11 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Versturen
            </button>
          </div>

          {/* WhatsApp deel — stuurt bij payments/reminders de JPG-foto als
              bijlage via Web Share API zodat de huurder de foto direct in
              de chat ziet (geen link). Fallback: wa.me met PDF-link. */}
          {tenantPhone && (
            <button
              onClick={openWa}
              disabled={waSharing}
              data-testid="send-whatsapp-open"
              className="w-full h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 transition shadow-[0_8px_20px_-5px_rgba(16,185,129,0.5)] disabled:opacity-70">
              {waSharing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Foto delen…</>
                : <><MessageCircle className="w-4 h-4" /> Open WhatsApp met huurder</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============== Backwards-compat: keep EmailDialog signature ==============
export function EmailDialog({ endpoint, subject, defaultTo, tenantName, documentLabel, onClose, onSent }) {
  const m = (endpoint || '').match(/\/email\/([^/]+)\/(.+)/);
  if (!m) return null;
  return (
    <SendDialog
      documentType={m[1]}
      documentId={m[2]}
      documentLabel={documentLabel}
      title={subject}
      tenantEmail={defaultTo || ''}
      tenantName={tenantName}
      onClose={onClose}
      onSent={onSent}
    />
  );
}
