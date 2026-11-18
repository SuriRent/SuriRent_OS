import { MONTHS_NL } from './api';

export function buildNfcPayment(overview, plans) {
  const { tenant, apartment, balance, open_invoices, current_invoices, current_month_invoice } = overview;
  const linked = new Set(plans.filter((plan) => plan.status === 'active').flatMap((plan) => plan.invoice_ids || []));
  const payable = new Map();
  for (const invoice of [...open_invoices, ...(current_invoices.length ? current_invoices : [current_month_invoice])]) {
    const outstanding = Number(invoice?.outstanding);
    if (invoice?.id && !['paid', 'cancelled', 'archived'].includes(invoice.status)
        && !linked.has(invoice.id) && Number.isFinite(outstanding) && outstanding > 0) {
      payable.set(invoice.id, invoice);
    }
  }
  const invoices = [...payable.values()].sort((a, b) => (a.period_year || 0) - (b.period_year || 0)
    || (a.period_month || 0) - (b.period_month || 0));
  const defaultCurrency = balance?.currency || apartment.currency || 'SRD';
  const currencies = new Set(invoices.map((invoice) => (invoice.currency || defaultCurrency).toUpperCase()));
  const amountCents = invoices.reduce((sum, invoice) => sum + Math.round(Number(invoice.outstanding) * 100), 0);
  if (currencies.size !== 1 || amountCents <= 0) return null;

  const first = invoices[0];
  const periods = [...new Set(invoices.filter((invoice) => MONTHS_NL[invoice.period_month - 1] && invoice.period_year)
    .map((invoice) => `${MONTHS_NL[invoice.period_month - 1]} ${invoice.period_year}`))];
  return {
    tenant_id: tenant.id,
    apartment_id: apartment.id,
    amount: amountCents / 100,
    currency: [...currencies][0],
    category: 'huur',
    method: 'contant',
    period_month: first.period_month || null,
    period_year: first.period_year || null,
    note: periods.length ? `Huur ${periods.join(', ')}` : 'Huurbetaling',
    invoice_ids: invoices.map((invoice) => invoice.id),
  };
}
