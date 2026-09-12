import { useState, useMemo } from 'react';
import { X, Check, Loader2, FileText, MessageCircle } from 'lucide-react';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../../../lib/api';
import { openWhatsApp } from '../../../../lib/external-link';
import KeyboardSafeModal from '../../../../components/KeyboardSafeModal';
import NumPad from '../../../../components/NumPad';

// =====================================================================
// QuickPayModal — één-klik betaling registreren vanuit de Facturen-detail
// zonder eerst naar Betalingen te navigeren. Prefilled met openstaand
// bedrag; toont direct de kwitantie na succes.
// NB: methode-keuze verwijderd op verzoek gebruiker (2026-02) — snelle
// registratie loopt altijd via 'contant'.
// Sinds 2026-02: als de huurder een telefoonnummer heeft opent na
// registratie automatisch WhatsApp met een voor-ingevuld bericht +
// kwitantie-foto link, tenzij admin de toggle uitzet.
// =====================================================================

// LocalStorage key voor de "auto WhatsApp" voorkeur — persistent per apparaat.
const AUTO_WA_KEY = 'quickpay:auto-whatsapp';

export default function QuickPayModal({ invoice, tenantName, tenantPhone = '', otherOpenInvoices = [], onClose, onSuccess }) {
  const remaining = useMemo(() => {
    const paid = Number(invoice.paid_amount || 0);
    const total = Number(invoice.amount || 0);
    return Math.max(0, total - paid);
  }, [invoice]);

  // Som van andere openstaande maanden (achterstand + huidig, geen future).
  // Wordt gebruikt om te bepalen of overbetaling naar andere maanden gaat
  // óf naar krediet (vooruitbetaling).
  const otherOpenTotal = useMemo(
    () => otherOpenInvoices.reduce(
      (s, i) => s + Number(i.remaining_amount != null ? i.remaining_amount : i.amount || 0), 0,
    ),
    [otherOpenInvoices],
  );

  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : String(invoice.amount || 0));
  const method = 'contant';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);   // succes-view
  const phoneDigits = String(tenantPhone || '').replace(/\D/g, '');
  const hasPhone = phoneDigits.length >= 7;
  const [autoWa, setAutoWa] = useState(() => {
    try { return (localStorage.getItem(AUTO_WA_KEY) || '1') !== '0'; }
    catch { return true; }
  });
  const toggleAutoWa = (v) => {
    setAutoWa(v);
    try { localStorage.setItem(AUTO_WA_KEY, v ? '1' : '0'); } catch { /* noop */ }
  };

  const parsedAmount = Number(String(amount).replace(',', '.'));
  const isValid = parsedAmount > 0 && !Number.isNaN(parsedAmount);
  // Overschot t.o.v. deze factuur; daarna hoeveel naar andere maanden gaat
  // en hoeveel eventueel als krediet blijft staan (echte vooruitbetaling).
  const surplus = Math.max(0, parsedAmount - remaining);
  const goesToOtherMonths = Math.min(surplus, otherOpenTotal);
  const goesToCredit = Math.max(0, surplus - otherOpenTotal);
  const hasSurplus = surplus > 0.001;

  const buildWaMessage = (r) => {
    const period = (r?.period_month && r?.period_year)
      ? `${MONTHS_NL[r.period_month - 1]} ${r.period_year}` : '';
    const lines = [
      `Hallo ${tenantName || ''},`,
      '',
      'Uw betaling is succesvol geregistreerd.',
      `Kwitantie: ${r.receipt_number}`,
      `Bedrag: ${r.currency} ${Number(r.amount).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`,
    ];
    if (period) lines.push(`Periode: ${period}`);
    return lines.join('\n');
  };

  // Deel de kwitantie-JPG als bijlage via Web Share API (native share-sheet
  // op iOS/Android → WhatsApp verschijnt als target zodat huurder de foto
  // direct als afbeelding ontvangt, niet als link). Fallback bij oudere
  // browsers: wa.me deeplink met tekst-only.
  const shareReceipt = async (r) => {
    const msg = buildWaMessage(r);
    try {
      const resp = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/payments/${r.id}/image`);
      if (!resp.ok) throw new Error('image fetch failed');
      const blob = await resp.blob();
      const file = new File([blob], `kwitantie-${r.receipt_number}.jpg`, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: msg, title: `Kwitantie ${r.receipt_number}` });
        return true;
      }
    } catch (e) {
      // Silent — Web Share niet beschikbaar of user cancelled → fallback
      if (e && e.name === 'AbortError') return false;
    }
    // Fallback: wa.me met tekst-only (huurder ziet géén foto-preview)
    if (hasPhone) openWhatsApp(phoneDigits, msg);
    return false;
  };

  const submit = async () => {
    if (!isValid) return;
    setLoading(true); setError('');
    try {
      // We geven bewust GEEN `invoice_ids` mee. De backend matcht op
      // period_month/period_year → primaire factuur, en spreidt eventuele
      // overflow FIFO over álle andere openstaande facturen van deze huurder.
      // Restant daarna wordt bewaard als krediet (credit_remaining) en
      // automatisch verrekend bij de volgende maand-generatie.
      const { data } = await api.post('/payments', {
        tenant_id: invoice.tenant_id,
        apartment_id: invoice.apartment_id || null,
        amount: parsedAmount,
        currency: invoice.currency || 'SRD',
        method,
        category: 'huur',
        period_month: invoice.period_month,
        period_year: invoice.period_year,
        note: '',
      });
      setReceipt(data);
      // Auto-share kwitantie-JPG via Web Share API of wa.me fallback.
      if (autoWa && hasPhone) {
        try { await shareReceipt(data); } catch { /* noop */ }
      }
    } catch (e) {
      setError(formatError(e) || 'Kon betaling niet registreren');
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    // Als er een kwitantie is aangemaakt geven we altijd terug aan de
    // parent, ook wanneer de gebruiker sluit via de X of buiten-klik.
    if (receipt && onSuccess) onSuccess(receipt);
    onClose();
  };

  if (receipt) {
    // Succes-scherm met kwitantienummer en PDF-download — via KeyboardSafeModal
    // zodat ook hier het toetsenbord-veilige patroon consistent blijft.
    return (
      <KeyboardSafeModal onClose={close} testId="quickpay-success">
        <KeyboardSafeModal.Header>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xl font-black text-slate-900">Betaling geregistreerd</h3>
            <button onClick={close} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-slate-500">
            <b className="text-slate-900">{tenantName || receipt.tenant_name}</b>
            {' · '}{receipt.currency} {Number(receipt.amount).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}
          </p>
        </KeyboardSafeModal.Header>

        <KeyboardSafeModal.Body className="text-center pt-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
            <Check className="w-8 h-8 text-emerald-600" strokeWidth={3} />
          </div>
          <p className="text-sm text-slate-500">Kwitantie succesvol aangemaakt</p>
          <div className="mt-4 bg-slate-50 rounded-2xl px-4 py-3 inline-block">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Kwitantienummer</p>
            <p className="font-mono text-lg font-black text-slate-900" data-testid="quickpay-receipt-nr">{receipt.receipt_number}</p>
          </div>
          {autoWa && hasPhone && (
            <p className="mt-3 text-[11px] text-emerald-700 font-bold inline-flex items-center gap-1 justify-center" data-testid="quickpay-wa-sent">
              <MessageCircle className="w-3.5 h-3.5" /> Deel-scherm geopend met kwitantie-foto
            </p>
          )}
        </KeyboardSafeModal.Body>

        <KeyboardSafeModal.Footer className="grid grid-cols-2 gap-2">
          {hasPhone ? (
            <button type="button"
              onClick={() => shareReceipt(receipt)}
              data-testid="quickpay-open-wa"
              className="h-12 rounded-xl bg-white border-2 border-emerald-300 hover:bg-emerald-50 text-emerald-700 font-bold inline-flex items-center justify-center gap-2 text-sm">
              <MessageCircle className="w-4 h-4" /> {autoWa ? 'Deel opnieuw' : 'Deel via WhatsApp'}
            </button>
          ) : (
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/payments/${receipt.id}/pdf`}
              target="_blank" rel="noreferrer"
              data-testid="quickpay-download-pdf"
              className="h-12 rounded-xl bg-white border-2 border-slate-200 hover:bg-slate-50 text-slate-700 font-bold inline-flex items-center justify-center gap-2 text-sm">
              <FileText className="w-4 h-4" /> Kwitantie PDF
            </a>
          )}
          <button onClick={close} data-testid="quickpay-close"
            className="h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold text-sm">
            Klaar
          </button>
        </KeyboardSafeModal.Footer>
      </KeyboardSafeModal>
    );
  }

  return (
    <KeyboardSafeModal onClose={close} testId="quickpay-modal">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xl font-black text-slate-900">Snelle betaling</h3>
          <button onClick={close} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-slate-500">
          <b className="text-slate-900">{tenantName || invoice.tenant_name}</b>
          {' · '}
          {MONTHS_NL[invoice.period_month - 1]} {invoice.period_year}
          {' · '}
          <span className="text-slate-400">{invoice.invoice_number}</span>
        </p>
      </KeyboardSafeModal.Header>

      <KeyboardSafeModal.Body>
          {/* Openstaand overzicht */}
          <div className="bg-slate-50 rounded-2xl p-4 mb-4 text-sm">
            <div className="flex justify-between mb-1">
              <span className="text-slate-500">Totaal factuur</span>
              <span className="font-bold text-slate-700">{fmtMoney(invoice.amount, invoice.currency)}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-slate-500">Reeds betaald</span>
              <span className="font-bold text-slate-700">{fmtMoney(invoice.paid_amount || 0, invoice.currency)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-200">
              <span className="text-slate-900 font-bold">Nog te betalen</span>
              <span className="font-black text-[#FF5C00]" data-testid="quickpay-remaining">{fmtMoney(remaining, invoice.currency)}</span>
            </div>
          </div>

          {error && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm" data-testid="quickpay-error">{error}</div>}

          {/* Bedrag — read-only display; input via custom numpad zodat het
              iPhone toetsenbord NIET opent en de layout niet verschuift. */}
          <div className="mb-3">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Bedrag *</label>
            <div className="mt-1 h-14 px-4 rounded-xl border-2 border-[#FF5C00] bg-orange-50/40 flex items-center justify-between">
              <span className="text-slate-400 font-bold text-sm">{invoice.currency}</span>
              <span className="text-2xl font-black text-slate-900 tabular-nums" data-testid="quickpay-amount">
                {amount || '0'}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <button type="button" onClick={() => setAmount(String(remaining))}
                data-testid="quickpay-set-remaining"
                className="text-[11px] font-bold text-[#FF5C00] hover:underline">
                Volledig openstaand ({fmtMoney(remaining, invoice.currency)})
              </button>
              {otherOpenTotal > 0 && (
                <button type="button" onClick={() => setAmount(String(remaining + otherOpenTotal))}
                  data-testid="quickpay-set-all-open"
                  className="text-[11px] font-bold text-emerald-700 hover:underline">
                  Alles openstaand ({fmtMoney(remaining + otherOpenTotal, invoice.currency)})
                </button>
              )}
            </div>
            {hasSurplus && (
              <div className="mt-2 space-y-1" data-testid="quickpay-alloc-preview">
                {goesToOtherMonths > 0 && (
                  <div className="flex items-start gap-1.5 text-[11px] font-bold text-emerald-700" data-testid="quickpay-alloc-other">
                    <Check className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>
                      {fmtMoney(goesToOtherMonths, invoice.currency)} wordt afgerekend op {otherOpenInvoices.length} andere openstaande maand{otherOpenInvoices.length === 1 ? '' : 'en'}
                    </span>
                  </div>
                )}
                {goesToCredit > 0 && (
                  <div className="flex items-start gap-1.5 text-[11px] font-bold text-amber-700" data-testid="quickpay-alloc-credit">
                    <Check className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>
                      {fmtMoney(goesToCredit, invoice.currency)} wordt vooruitbetaling — automatisch verrekend met de volgende maand
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Methode-selectie verwijderd op verzoek gebruiker (2026-02):
              QuickPay registreert nu altijd als 'contant' (initial state). */}

          {/* Auto-share toggle: deelt na Registreer automatisch de
              kwitantie-JPG via het native share-scherm (iOS/Android →
              WhatsApp toont foto direct in chat, geen link). Voorkeur
              persistent in localStorage. */}
          {hasPhone && (
            <label className="flex items-center justify-between gap-3 mb-3 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 cursor-pointer" data-testid="quickpay-auto-wa">
              <span className="flex items-center gap-2 text-xs font-bold text-emerald-800">
                <MessageCircle className="w-4 h-4" />
                Deel kwitantie-foto direct na Registreer
              </span>
              <input type="checkbox" checked={autoWa}
                onChange={(e) => toggleAutoWa(e.target.checked)}
                data-testid="quickpay-auto-wa-toggle"
                className="w-5 h-5 rounded accent-emerald-600 cursor-pointer" />
            </label>
          )}

          {/* Custom numpad — geen native toetsenbord = geen viewport-shift. */}
          <NumPad
            value={amount}
            onChange={setAmount}
            testIdPrefix="quickpay-npad" />
      </KeyboardSafeModal.Body>

      <KeyboardSafeModal.Footer className="flex gap-3">
        <button onClick={close} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
        <button onClick={submit} disabled={loading || !isValid} data-testid="quickpay-submit"
          className="flex-1 h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Registreer
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}
