import { buildConfirmPayment, canChangeConfirmAmount, parseConfirmAmount } from './kiosk-confirm-payment';

const cash = { method: 'contant', amount: 125, plain_amount: 125, currency: 'SRD', invoice_ids: ['first', 'second'] };

test('reduces the cash amount to book without changing the selected invoices', () => {
  const amount = parseConfirmAmount(' 50,25 ', cash.amount);
  expect(buildConfirmPayment(cash, amount)).toEqual({
    ...cash, amount: 50.25, plain_amount: 50.25, note: 'Gedeeltelijke betaling — SRD 50,25',
  });
  expect(buildConfirmPayment(cash, parseConfirmAmount('125', cash.amount))).toBe(cash);
});

test.each(['0', '-1', '125,01', '50,255', '5e1'])('rejects invalid partial amount %s', (input) => {
  expect(() => parseConfirmAmount(input, cash.amount)).toThrow();
});

test.each([
  { method: 'bank' },
  { method: 'ideal', stripe_paid: true },
  { plan_items: [{ plan_id: 'p', seq: 1 }] },
])('does not alter a payment with %j', (fields) => {
  const payment = { ...cash, ...fields };
  expect(canChangeConfirmAmount(payment)).toBe(false);
  expect(buildConfirmPayment(payment, 50)).toBe(payment);
});
