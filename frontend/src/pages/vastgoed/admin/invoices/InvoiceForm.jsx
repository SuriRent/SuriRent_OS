import { useState } from 'react';
import { X, Check, Loader2, History, Calendar } from 'lucide-react';
import { api, formatError, MONTHS_NL } from '../../../../lib/api';
import KeyboardSafeModal from '../../../../components/KeyboardSafeModal';

// =====================================================================
// Invoice creation modal — admin maakt nieuwe factuur voor 1 huurder
// Twee modi:
//  1. "Normaal": genereert factuur voor gekozen maand/jaar met huur-bedrag
//     van appartement (via POST /invoices).
//  2. "Historisch": vrije datum + vrij bedrag + vrije omschrijving voor
//     onboarding van bestaande achterstanden (via POST /invoices/historical).
// =====================================================================
const Plain = ({ children, className = '' }) => <div className={className}>{children}</div>;
const INLINE = { Root: ({ children }) => <div className="space-y-4" data-testid="invoice-inline">{children}</div>, Header: Plain, Body: Plain, Footer: Plain };
const MODAL = { Root: KeyboardSafeModal, Header: KeyboardSafeModal.Header, Body: KeyboardSafeModal.Body, Footer: KeyboardSafeModal.Footer };

// `inline` = zonder eigen popup, voor gebruik binnen een bestaande popup (kiosk).
export default function InvoiceForm({ tenants, onCancel, onSaved, inline = false }) {
  const W = inline ? INLINE : MODAL;
  const today = new Date();
  const [mode, setMode] = useState('normal'); // 'normal' | 'historical'
  const [data, setData] = useState({
    tenant_id: '',
    period_month: today.getMonth() + 1,
    period_year: today.getFullYear(),
  });
  const [hist, setHist] = useState({
    amount: '',
    // Historische facturen worden per MAAND geboekt (niet per specifieke
    // dag) — we sturen naar de backend altijd de 1e van de gekozen maand
    // zodat het endpoint (dat een `date` verwacht) `period_month`/`period_year`
    // correct afleidt.
    period_month: today.getMonth() + 1,
    period_year: today.getFullYear(),
    description: '',
    currency: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setLoading(true); setError('');
    try {
      if (mode === 'historical') {
        const amt = Number(String(hist.amount).replace(',', '.'));
        // Bouw ISO-datum uit maand+jaar (1e van de maand)
        const mm = String(hist.period_month).padStart(2, '0');
        const isoDate = `${hist.period_year}-${mm}-01`;
        const { data: r } = await api.post('/invoices/historical', {
          tenant_id: data.tenant_id,
          amount: amt,
          date: isoDate,
          description: hist.description.trim(),
          currency: hist.currency || undefined,
        });
        onSaved(r);
      } else {
        const { data: r } = await api.post('/invoices', {
          tenant_id: data.tenant_id,
          period_month: parseInt(data.period_month),
          period_year: parseInt(data.period_year),
        });
        onSaved(r);
      }
    } catch (e) { setError(formatError(e)); }
    finally { setLoading(false); }
  };

  const isHist = mode === 'historical';
  const canSave = data.tenant_id
    && (!isHist || (Number(String(hist.amount).replace(',', '.')) > 0 && hist.description.trim() && hist.period_month && hist.period_year));

  return (
    <W.Root onClose={onCancel} testId="invoice-modal">
      <W.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">
            {isHist ? 'Historische factuur' : 'Nieuwe factuur'}
          </h3>
          {!inline && <button onClick={onCancel} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>}
        </div>
        {/* Segmented toggle — Normaal vs Historisch */}
        <div className="mt-3 grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl" data-testid="invoice-mode-toggle">
          <button type="button" onClick={() => setMode('normal')} data-testid="invoice-mode-normal"
            className={`h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${mode === 'normal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            <Calendar className="w-3.5 h-3.5" /> Nieuwe factuur
          </button>
          <button type="button" onClick={() => setMode('historical')} data-testid="invoice-mode-historical"
            className={`h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${mode === 'historical' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            <History className="w-3.5 h-3.5" /> Historische achterstand
          </button>
        </div>
      </W.Header>

      <W.Body>
        {error && <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm" data-testid="invoice-error">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Huurder *</label>
            <select value={data.tenant_id} onChange={(e) => setData({ ...data, tenant_id: e.target.value })}
              data-testid="invoice-tenant" required
              className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
              <option value="">— Kies huurder —</option>
              {tenants
                .filter((t) => isHist ? true : t.apartment_id)
                .sort((a, b) => (a.apartment_number || '').localeCompare(b.apartment_number || '', 'nl', { numeric: true, sensitivity: 'base' }))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.apartment_number ? `${t.apartment_number} — ` : ''}{t.name}
                  </option>
                ))}
            </select>
          </div>

          {!isHist && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Maand</label>
                <select value={data.period_month} onChange={(e) => setData({ ...data, period_month: e.target.value })}
                  data-testid="invoice-month"
                  className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                  {MONTHS_NL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Jaar</label>
                <input type="number" value={data.period_year} onChange={(e) => setData({ ...data, period_year: e.target.value })}
                  data-testid="invoice-year" inputMode="numeric"
                  className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
              </div>
            </div>
          )}

          {isHist && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Maand *</label>
                  <select
                    value={hist.period_month}
                    onChange={(e) => setHist({ ...hist, period_month: parseInt(e.target.value) })}
                    data-testid="hist-month"
                    className="w-full min-w-0 mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                    {MONTHS_NL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Jaar *</label>
                  <input type="number"
                    value={hist.period_year}
                    max={today.getFullYear()}
                    min={2000}
                    onChange={(e) => setHist({ ...hist, period_year: parseInt(e.target.value) || today.getFullYear() })}
                    data-testid="hist-year" inputMode="numeric"
                    className="w-full min-w-0 mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none tabular-nums" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Bedrag *</label>
                <div className="flex mt-1 gap-1.5">
                  <select value={hist.currency}
                    onChange={(e) => setHist({ ...hist, currency: e.target.value })}
                    data-testid="hist-currency"
                    className="w-24 h-12 px-2 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white text-sm font-bold">
                    <option value="">Auto</option>
                    <option value="SRD">SRD</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                  <input type="text" inputMode="decimal"
                    value={hist.amount}
                    onChange={(e) => setHist({ ...hist, amount: e.target.value.replace(/[^0-9.,]/g, '') })}
                    placeholder="0,00"
                    data-testid="hist-amount"
                    className="flex-1 min-w-0 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none tabular-nums" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Omschrijving *</label>
                <input type="text"
                  value={hist.description}
                  maxLength={200}
                  placeholder="bv. Achterstand huur maart 2025"
                  onChange={(e) => setHist({ ...hist, description: e.target.value })}
                  data-testid="hist-description"
                  className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
              </div>
            </>
          )}
        </div>
      </W.Body>

      <W.Footer className="flex gap-3">
        <button onClick={onCancel} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
        <button onClick={save} disabled={loading || !canSave} data-testid="invoice-save"
          className="flex-1 h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Aanmaken
        </button>
      </W.Footer>
    </W.Root>
  );
}
