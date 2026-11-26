import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../lib/api';
import SmsPaymentPage from './SmsPaymentPage';

let mockToken = 'abc';
jest.mock('react-router-dom', () => ({ useParams: () => ({ token: mockToken }) }));
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  fmtMoney: (amount, currency) => `${currency} ${amount}`,
  formatError: () => 'Ongeldige betaallink',
}));
jest.mock('../components/StripePayElements', () => ({
  StripePayElements: ({ onPaid, onUncertain, returnUrl, amountLabel }) => (
    <>
      <button onClick={onPaid} data-return-url={returnUrl}>Stripe {amountLabel}</button>
      <button onClick={onUncertain}>Onzekere betaalstatus</button>
    </>
  ),
}));

beforeEach(() => {
  mockToken = 'abc';
  sessionStorage.clear();
  jest.clearAllMocks();
});

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

    test('maakt checkout voor geselecteerde post en toont pas na servercontrole een bevestiging', async () => {
      mockToken = 'A'.repeat(22);
      api.get.mockResolvedValue({ data: {
        company: { name: 'Bedrijf' },
        items: [{ kind: 'invoice', id: 'i1', reference: 'F-1', amount: 100, currency: 'SRD' }],
        online_methods: [{ id: 'card', label: 'Creditcard' }], bank_accounts: [], online_payment_available: true,
      } });
      api.post.mockResolvedValueOnce({ data: {
        item: { kind: 'invoice', id: 'i1' }, method: 'card', attempt_id: 'attempt1',
        amount_cents: 10000, currency: 'SRD', provider_amount_cents: 250, provider_currency: 'EUR',
        publishable_key: 'pk_test_example', client_secret: 'secret',
      } }).mockResolvedValueOnce({ data: { status: 'paid', receipt_number: 'KW-1' } });
      const host = document.createElement('div');
      const root = createRoot(host);
      const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      try {
        await act(async () => root.render(<SmsPaymentPage />));
        await act(async () => host.querySelector('button').click());
        expect(api.post).toHaveBeenNthCalledWith(1, '/public/sms-payment/start',
          { item: { kind: 'invoice', id: 'i1' }, method: 'card' },
          { headers: { 'X-Sms-Payment-Token': mockToken } });
        const stored = JSON.parse(sessionStorage.getItem('surirent_sms_checkout'));
        expect(stored.attempt_id).toBe('attempt1');
        expect(JSON.stringify(stored)).not.toContain('secret');
        const stripe = [...host.querySelectorAll('button')].find((button) => button.textContent.includes('Stripe'));
        expect(stripe.dataset.returnUrl).toBe(`${window.location.origin}/b/return`);
        expect(stripe.dataset.returnUrl).not.toContain(mockToken);
        expect(host.textContent).not.toContain('Betaling bevestigd');
        await act(async () => stripe.click());
        expect(api.post).toHaveBeenNthCalledWith(2, '/public/sms-payment/finish',
          { item: { kind: 'invoice', id: 'i1' }, attempt_id: 'attempt1' },
          { headers: { 'X-Sms-Payment-Token': mockToken } });
        expect(host.textContent).toContain('Betaling bevestigd');
        expect(host.textContent).toContain('KW-1');
        expect(sessionStorage.getItem('surirent_sms_checkout')).toBeNull();
      } finally {
        await act(async () => root.unmount());
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
      }
    });

    test('controleert terugkeer zonder status of geheim uit de URL te vertrouwen', async () => {
      mockToken = 'return';
      const token = 'B'.repeat(22);
      sessionStorage.setItem('surirent_sms_checkout', JSON.stringify({
        token, item: { kind: 'installment', plan_id: 'p1', sequence: 1 }, attempt_id: 'attempt2',
      }));
      api.post.mockRejectedValueOnce(new Error('pending')).mockResolvedValueOnce({
        data: { status: 'paid', receipt_number: 'KW-2' },
      });
      const host = document.createElement('div');
      const root = createRoot(host);
      const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      try {
        await act(async () => root.render(<SmsPaymentPage />));
        expect(api.get).not.toHaveBeenCalled();
        expect(host.textContent).toContain('nog niet bevestigd');
        expect(host.textContent).not.toContain('Betaling bevestigd');
        expect(sessionStorage.getItem('surirent_sms_checkout')).not.toBeNull();
        await act(async () => host.querySelector('button').click());
        expect(api.post).toHaveBeenCalledWith('/public/sms-payment/finish',
          { item: { kind: 'installment', plan_id: 'p1', sequence: 1 }, attempt_id: 'attempt2' },
          { headers: { 'X-Sms-Payment-Token': token } });
        expect(host.textContent).toContain('KW-2');
      } finally {
        await act(async () => root.unmount());
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
      }
    });

    test('start geen betaling als opslaan van de betaalstatus mislukt', async () => {
      mockToken = 'C'.repeat(22);
      api.get.mockResolvedValue({ data: {
        company: { name: 'Bedrijf' },
        items: [{ kind: 'invoice', id: 'i1', reference: 'F-1', amount: 10, currency: 'EUR' }],
        online_methods: [{ id: 'mope', label: 'Mopé' }], bank_accounts: [], online_payment_available: true,
      } });
      const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      const host = document.createElement('div');
      const root = createRoot(host);
      const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      try {
        await act(async () => root.render(<SmsPaymentPage />));
        await act(async () => host.querySelector('button').click());
        expect(api.post).not.toHaveBeenCalled();
        expect(host.textContent).toContain('Start de betaling niet');
      } finally {
        setItem.mockRestore();
        await act(async () => root.unmount());
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
      }
    });

test('Mopé toont het serverbedrag en alleen een vertrouwde betaallink', async () => {
  mockToken = 'D'.repeat(22);
  api.get.mockResolvedValue({ data: {
    company: { name: 'Bedrijf' },
    items: [{ kind: 'installment', plan_id: 'p1', sequence: 1, amount: 10, currency: 'SRD' }],
    online_methods: [{ id: 'mope', label: 'Mopé' }], bank_accounts: [], online_payment_available: true,
  } });
  api.post.mockResolvedValue({ data: {
    item: { kind: 'installment', plan_id: 'p1', sequence: 1 }, method: 'mope', attempt_id: 'attempt1',
    amount_cents: 1200, currency: 'SRD', payment_url: 'https://mope.sr/pay/123',
  } });
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<SmsPaymentPage />));
    await act(async () => host.querySelector('button').click());
    expect(api.post).toHaveBeenCalledWith('/public/sms-payment/start',
      { item: { kind: 'installment', plan_id: 'p1', sequence: 1 }, method: 'mope' },
      { headers: { 'X-Sms-Payment-Token': mockToken } });
    expect(host.textContent).toContain('SRD 12');
    expect(host.querySelector('a').href).toBe('https://mope.sr/pay/123');
    expect(host.querySelector('a').rel).toBe('noreferrer');
    expect(host.textContent).not.toContain('Betaling bevestigd');
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test('opent geen onbekende Mopé-URL en laat de poging voor controle staan', async () => {
  mockToken = 'E'.repeat(22);
  api.get.mockResolvedValue({ data: {
    company: { name: 'Bedrijf' },
    items: [{ kind: 'invoice', id: 'i1', reference: 'F-1', amount: 10, currency: 'SRD' }],
    online_methods: [{ id: 'mope', label: 'Mopé' }], bank_accounts: [], online_payment_available: true,
  } });
  api.post.mockResolvedValue({ data: {
    item: { kind: 'invoice', id: 'i1' }, method: 'mope', attempt_id: 'attempt1',
    amount_cents: 1000, currency: 'SRD', payment_url: 'https://mope.sr.example.com/steal',
  } });
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<SmsPaymentPage />));
    await act(async () => host.querySelector('button').click());
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('niet worden bevestigd');
    expect(JSON.parse(sessionStorage.getItem('surirent_sms_checkout')).attempt_id).toBe('attempt1');
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test('adviseert contact bij een onzekere start zonder poging-ID', async () => {
  mockToken = 'F'.repeat(22);
  api.get.mockResolvedValue({ data: {
    company: { name: 'Bedrijf' },
    items: [{ kind: 'invoice', id: 'i1', reference: 'F-1', amount: 10, currency: 'SRD' }],
    online_methods: [{ id: 'mope', label: 'Mopé' }], bank_accounts: [], online_payment_available: true,
  } });
  api.post.mockRejectedValue(new Error('network'));
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<SmsPaymentPage />));
    await act(async () => host.querySelector('button').click());
    expect(host.textContent).toContain('Neem contact op met uw verhuurder voordat u opnieuw betaalt');
    expect(host.querySelector('button').disabled).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('surirent_sms_checkout')).attempt_id).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test('bewaarde poging blijft controleerbaar als de post niet meer openstaat', async () => {
  mockToken = 'G'.repeat(22);
  sessionStorage.setItem('surirent_sms_checkout', JSON.stringify({
    token: mockToken, item: { kind: 'invoice', id: 'i1' }, attempt_id: 'attempt1',
  }));
  api.get.mockResolvedValue({ data: {
    company: { name: 'Bedrijf' }, items: [], online_methods: [],
    bank_accounts: [], online_payment_available: true,
  } });
  api.post.mockResolvedValue({ data: { status: 'paid', receipt_number: 'KW-3' } });
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<SmsPaymentPage />));
    await act(async () => host.querySelector('button').click());
    expect(host.textContent).toContain('KW-3');
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test('controleert een onzekere Stripe-status zonder opnieuw te betalen', async () => {
  mockToken = 'H'.repeat(22);
  api.get.mockResolvedValue({ data: {
    company: { name: 'Bedrijf' },
    items: [{ kind: 'invoice', id: 'i1', reference: 'F-1', amount: 10, currency: 'EUR' }],
    online_methods: [{ id: 'card', label: 'Creditcard' }], bank_accounts: [], online_payment_available: true,
  } });
  api.post.mockResolvedValueOnce({ data: {
    item: { kind: 'invoice', id: 'i1' }, method: 'card', attempt_id: 'attempt1',
    amount_cents: 1000, currency: 'EUR', provider_amount_cents: 1000, provider_currency: 'EUR',
    publishable_key: 'pk_test_example', client_secret: 'secret',
  } }).mockRejectedValueOnce(new Error('pending'));
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<SmsPaymentPage />));
    await act(async () => host.querySelector('button').click());
    const uncertain = [...host.querySelectorAll('button')]
      .find((button) => button.textContent === 'Onzekere betaalstatus');
    await act(async () => uncertain.click());
    expect(api.post).toHaveBeenNthCalledWith(2, '/public/sms-payment/finish',
      { item: { kind: 'invoice', id: 'i1' }, attempt_id: 'attempt1' },
      { headers: { 'X-Sms-Payment-Token': mockToken } });
    expect(host.textContent).toContain('nog niet bevestigd');
    expect(host.textContent).not.toContain('Betaling bevestigd');
    expect(host.textContent).not.toContain('Verder met betalen');
    expect(JSON.parse(sessionStorage.getItem('surirent_sms_checkout')).attempt_id).toBe('attempt1');
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
