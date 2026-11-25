import { buildConfirmPayment, canChangeConfirmAmount, canUseOnlineProvider, parseConfirmAmount } from './kiosk-confirm-payment';

test('online provider accepts a single installment but not a mixed or multiple selection', () => {
  expect(canUseOnlineProvider({ amount: 50, plan_items: [], plain_amount: 50 })).toBe(true);
  expect(canUseOnlineProvider({ amount: 50, plan_items: [{ amount: 50 }], plain_amount: 0 })).toBe(true);
  expect(canUseOnlineProvider({ amount: 75, plan_items: [{ amount: 50 }], plain_amount: 25 })).toBe(false);
  expect(canUseOnlineProvider({ amount: 50, plan_items: [{ amount: 25 }, { amount: 25 }], plain_amount: 0 })).toBe(false);
  expect(canUseOnlineProvider({ amount: 50, plan_items: [{ amount: 40 }], plain_amount: 0 })).toBe(false);
});

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
