import { renderToStaticMarkup } from 'react-dom/server';
import { ProcessingPayments } from './Payments';

jest.mock('react-router-dom', () => ({ useLocation: jest.fn(), useNavigate: jest.fn() }));

test('toont verwerkingsstatus zonder betaal- of verwijderknop', () => {
  const html = renderToStaticMarkup(<ProcessingPayments payments={[{
    id: 'p1', tenant_name: 'Huurder', receipt_number: 'B1', currency: 'SRD',
    amount: 50, status: 'rejecting',
  }]} />);
  expect(html).toContain('Betalingen in verwerking of ter controle');
  expect(html).toContain('Huurder');
  expect(html).toContain('B1');
  expect(html).toContain('Afwijzing');
  expect(html).not.toContain('<button');
});

test('verbergt de melding als er geen betalingen in verwerking zijn', () => {
  expect(renderToStaticMarkup(<ProcessingPayments payments={[]} />)).toBe('');
});

test('toont een achtergebleven bankvergrendeling zonder betaling', () => {
  const html = renderToStaticMarkup(<ProcessingPayments
    payments={[]}
    guards={[{ tenant_id: 't1', operation: 'bank_reconciliation', operation_id: 's1' }]}
    tenants={[{ id: 't1', name: 'Huurder' }]}
  />);
  expect(html).toContain('Huurder');
  expect(html).toContain('Bankregistratie');
  expect(html).toContain('s1');
  expect(html).not.toContain('<button');
});

test('toont een betaling niet dubbel als ook de vergrendeling zichtbaar is', () => {
  const html = renderToStaticMarkup(<ProcessingPayments
    payments={[{ id: 'p1', tenant_name: 'Huurder', currency: 'SRD', amount: 50, status: 'approving' }]}
    guards={[{ tenant_id: 't1', operation: 'payment_approval', operation_id: 'p1' }]}
  />);
  expect(html.match(/Huurder/g)).toHaveLength(1);
});

test('toont een achtergebleven factuurverplaatsing', () => {
  const html = renderToStaticMarkup(<ProcessingPayments
    payments={[]}
    guards={[{ tenant_id: 't1', operation: 'payment_reassignment', operation_id: 'p1' }]}
  />);
  expect(html).toContain('Betaling verplaatsen');
  expect(html).toContain('p1');
  expect(html).not.toContain('<button');
});

test('toont een achtergebleven betaalregistratie', () => {
  const html = renderToStaticMarkup(<ProcessingPayments
    payments={[]}
    guards={[{ tenant_id: 't1', operation: 'payment_creation', operation_id: 'p1' }]}
  />);
  expect(html).toContain('Betaling registreren');
  expect(html).toContain('p1');
});

test.each([
  ['stripe_request', 'Stripe-betaalverzoek'],
  ['mope_request', 'Mopé-betaalverzoek'],
  ['installment_payment', 'Termijnbetaling'],
  ['payment_plan_change', 'Wijziging betalingsregeling'],
  ['payment_deletion', 'Betaling verwijderen'],
  ['credit_reconciliation', 'Tegoed verrekenen'],
  ['invoice_change', 'Factuur wijzigen'],
])('toont een achtergebleven providerverzoek: %s', (operation, label) => {
  const html = renderToStaticMarkup(<ProcessingPayments
    payments={[]}
    guards={[{ tenant_id: 't1', operation, operation_id: 'request1' }]}
  />);
  expect(html).toContain(label);
  expect(html).toContain('request1');
});

test('meldt wanneer de verwerkingsstatus niet kan worden opgehaald', () => {
  const html = renderToStaticMarkup(<ProcessingPayments payments={[]} unavailable />);
  expect(html).toContain('Verwerkingsstatus kon niet worden opgehaald');
});
