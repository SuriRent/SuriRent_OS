import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../lib/api';
import SmsPaymentPage from './SmsPaymentPage';

jest.mock('react-router-dom', () => ({ useParams: () => ({ token: 'abc' }) }));
jest.mock('../lib/api', () => ({
  api: { get: jest.fn() },
  fmtMoney: (amount, currency) => `${currency} ${amount}`,
  formatError: () => 'Ongeldige betaallink',
}));

test('toont alleen de opgehaalde posten en beschikbare instructies', async () => {
  api.get.mockResolvedValue({ data: {
    company: { name: 'Bedrijf', address: 'Straat 1' },
    items: [{ kind: 'invoice', id: 'i1', reference: 'F-1', amount: 100, currency: 'SRD' }],
    online_methods: [{ id: 'mope', label: 'Mopé' }],
    bank_accounts: [{ country: 'Suriname', account: '12345' }],
    online_payment_available: false,
  } });
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<SmsPaymentPage />));
    expect(api.get).toHaveBeenCalledWith('/public/sms-payment', {
      headers: { 'X-Sms-Payment-Token': 'abc' },
    });
    expect(host.textContent).toContain('Factuur F-1');
    expect(host.textContent).toContain('SRD 100');
    expect(host.textContent).toContain('Suriname: 12345');
    expect(host.textContent).toContain('Online betalen via deze pagina is nog niet beschikbaar');
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
