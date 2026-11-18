import { buildNfcPayment } from './kiosk-nfc-payment';

const invoice = (id, month, outstanding, currency = 'SRD') => ({
  id, outstanding, currency, period_month: month, period_year: 2026,
});
const overview = {
  tenant: { id: 'tenant-a' },
  apartment: { id: 'apt-a' },
  balance: { currency: 'SRD' },
  open_invoices: [],
  current_invoices: [],
};

test('prepares cash confirmation for the scanned tenant with current and overdue balances only', () => {
  const current = invoice('current', 11, 99.95);
  const result = buildNfcPayment({
    ...overview,
    open_invoices: [invoice('older', 10, 25.1), invoice('linked', 9, 100), invoice('settled', 8, 0),
      { ...invoice('cancelled', 7, 120), status: 'cancelled' }],
    current_invoices: [current, current],
    current_month_invoice: current,
    future_invoices: [invoice('future', 12, 500)],
  }, [{ status: 'active', invoice_ids: ['linked'] }]);
  expect(result).toMatchObject({
    tenant_id: 'tenant-a', apartment_id: 'apt-a', amount: 125.05, currency: 'SRD',
    method: 'contant', period_month: 10, period_year: 2026, invoice_ids: ['older', 'current'],
  });
});

test('uses the legacy current invoice and keeps its actual currency', () => {
  expect(buildNfcPayment({ ...overview, current_month_invoice: invoice('current', 11, 50, 'usd') }, []))
    .toMatchObject({ amount: 50, currency: 'USD', invoice_ids: ['current'] });
});

test('does not prepare a confirmation for zero balances or mixed currencies', () => {
  expect(buildNfcPayment(overview, [])).toBeNull();
  expect(buildNfcPayment({
    ...overview,
    open_invoices: [invoice('srd', 10, 50), invoice('usd', 9, 10, 'USD')],
  }, [])).toBeNull();
});
