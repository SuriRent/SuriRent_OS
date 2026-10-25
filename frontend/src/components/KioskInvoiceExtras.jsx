import { useCallback, useEffect, useState } from 'react';
import { FileDown, Loader2, Mail, Wallet } from 'lucide-react';
import { api, formatError } from '../lib/api';
import { fmtAmount } from '../pages/vastgoed/admin/invoices/helpers';
import { SendDialog } from './EmailDialog';

export const SEVERITY_OPTS = [
  { v: 'all', label: 'Alle' },
  { v: 'critical', label: 'Kritiek', dot: 'bg-red-500' },
  { v: 'late', label: 'Te laat', dot: 'bg-amber-500' },
  { v: 'ok', label: 'Op tijd', dot: 'bg-emerald-500' },
];

export function SeverityPills({ value, onChange, testPrefix }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto" data-testid={`${testPrefix}-severity`}>
      {SEVERITY_OPTS.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)} data-testid={`${testPrefix}-severity-${o.v}`}
          className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${value === o.v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          {o.dot && <span className={`w-2 h-2 rounded-full ${o.dot}`} />}{o.label}
        </button>
      ))}
    </div>
  );
}

// Tegoed per huurder per valuta (vooruitbetaald, nog niet verrekend).
export function useTenantCredits() {
  const [credits, setCredits] = useState({});
  const reload = useCallback(() => {
    api.get('/tenants/credits').then(({ data }) => setCredits(data || {})).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return [credits, reload];
}

export const creditOf = (credits, tenantId, cur) => Number((credits[tenantId] || {})[cur || 'SRD'] || 0);

export function CreditBadge({ amount, currency, testId }) {
  if (!(amount > 0)) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold px-2 py-0.5" data-testid={testId}>
      <Wallet className="w-3 h-3" /> {currency || 'SRD'} {fmtAmount(amount, currency)} tegoed
    </span>
  );
}

const BTN = 'w-10 h-10 rounded-lg bg-slate-100 hover:bg-orange-50 text-slate-500 hover:text-[#FF5C00] flex items-center justify-center transition-colors shrink-0 disabled:opacity-50';

// PDF, mailen en tegoed toepassen per factuur.
export function InvoiceExtraActions({ inv, open, credit, tenant, onChanged, onMsg }) {
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  const apply = async () => {
    setApplying(true);
    try {
      const { data } = await api.post(`/invoices/${inv.id}/apply-credit`);
      onMsg?.({ ok: true, text: `${inv.currency || 'SRD'} ${fmtAmount(data.applied, inv.currency)} tegoed toegepast op ${inv.invoice_number}` });
      onChanged?.();
    } catch (e) { onMsg?.({ ok: false, text: formatError(e) }); } finally { setApplying(false); }
  };
  return (
    <>
      {open && credit > 0 && (
        <button type="button" onClick={apply} disabled={applying} aria-label="Tegoed toepassen" title="Tegoed toepassen"
          data-testid={`inv-apply-credit-${inv.id}`} className={`${BTN} !bg-emerald-50 !text-emerald-700 hover:!bg-emerald-100`}>
          {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
        </button>
      )}
      <a href={`${process.env.REACT_APP_BACKEND_URL}/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"
        aria-label="PDF downloaden" title="PDF downloaden" data-testid={`inv-pdf-${inv.id}`} className={BTN}>
        <FileDown className="w-4 h-4" />
      </a>
      <button type="button" onClick={() => setSending(true)} aria-label="Mailen" title="Factuur mailen"
        data-testid={`inv-mail-${inv.id}`} className={BTN}>
        <Mail className="w-4 h-4" />
      </button>
      {sending && (
        <SendDialog zClass="z-[140]" documentType="invoice" documentId={inv.id} documentLabel="factuur"
          title={`Factuur ${inv.invoice_number} versturen`} tenantEmail={tenant?.email || ''}
          tenantPhone={tenant?.phone || ''} tenantName={tenant?.name || ''}
          onClose={() => setSending(false)} onSent={() => setSending(false)} />
      )}
    </>
  );
}
