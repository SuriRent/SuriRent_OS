import { fmtMoney } from './api';

export function canChangeConfirmAmount(payload) {
  return payload.method === 'contant' && !payload.stripe_paid
    && !payload.plan_items?.length && Number(payload.amount) > 0;
}

export function parseConfirmAmount(value, maximum) {
  const input = value.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(input)) {
    throw new Error('Voer een geldig bedrag in met maximaal twee decimalen.');
  }
  const amount = Number(input.replace(',', '.'));
  if (amount <= 0) throw new Error('Voer een bedrag groter dan nul in.');
  if (amount > maximum) throw new Error('Het bedrag mag niet hoger zijn dan het oorspronkelijke bedrag.');
  return amount;
}

export function buildConfirmPayment(payload, amount) {
  if (!canChangeConfirmAmount(payload) || amount === Number(payload.amount)) return payload;
  return {
    ...payload,
    amount,
    plain_amount: amount,
    note: `Gedeeltelijke betaling — ${fmtMoney(amount, payload.currency || 'SRD')}`,
  };
}
