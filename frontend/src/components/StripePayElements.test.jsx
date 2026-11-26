import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StripePayElements } from './StripePayElements';

const mockConfirmPayment = jest.fn();
const mockElements = {};
jest.mock('@stripe/stripe-js/pure', () => ({ loadStripe: jest.fn() }));
jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => children,
  PaymentElement: () => <div>Betaalgegevens</div>,
  useStripe: () => ({ confirmPayment: mockConfirmPayment }),
  useElements: () => mockElements,
}));

beforeEach(() => {
  mockConfirmPayment.mockReset();
});

test.each([
  ['succeeded', 'paid'],
  ['processing', 'paid'],
  ['requires_action', 'uncertain'],
])('Stripe-status %s gaat naar %s', async (status, expected) => {
  mockConfirmPayment.mockResolvedValue({ paymentIntent: { status } });
  const onPaid = jest.fn();
  const onUncertain = jest.fn();
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<StripePayElements publishableKey="pk_test_example" clientSecret="secret"
      amountLabel="EUR 1" returnUrl="https://example.test/b/return" onPaid={onPaid} onUncertain={onUncertain} />));
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mockConfirmPayment).toHaveBeenCalledWith({
      elements: mockElements, confirmParams: { return_url: 'https://example.test/b/return' }, redirect: 'if_required',
    });
    expect(onPaid).toHaveBeenCalledTimes(expected === 'paid' ? 1 : 0);
    expect(onUncertain).toHaveBeenCalledTimes(expected === 'uncertain' ? 1 : 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test.each([
  ['afgewezen kaart', { error: { type: 'card_error', message: 'Kaart geweigerd' } }, false],
  ['onzekere Stripe-fout', { error: { type: 'api_connection_error' } }, true],
])('%s blijft veilig verwerkbaar', async (_label, result, uncertain) => {
  mockConfirmPayment.mockResolvedValue(result);
  const onUncertain = jest.fn();
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<StripePayElements publishableKey="pk_test_example" clientSecret="secret"
      amountLabel="EUR 1" onUncertain={onUncertain} />));
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onUncertain).toHaveBeenCalledTimes(uncertain ? 1 : 0);
    if (!uncertain) {
      expect(host.textContent).toContain('Kaart geweigerd');
      expect(host.querySelector('button').disabled).toBe(false);
    }
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test('controleert een onverwachte netwerkfout in plaats van de betaling opnieuw te starten', async () => {
  mockConfirmPayment.mockRejectedValue(new Error('network'));
  const onUncertain = jest.fn();
  const onPaid = jest.fn();
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<StripePayElements publishableKey="pk_test_example" clientSecret="secret"
      amountLabel="EUR 1" onPaid={onPaid} onUncertain={onUncertain} />));
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onUncertain).toHaveBeenCalledTimes(1);
    expect(onPaid).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
