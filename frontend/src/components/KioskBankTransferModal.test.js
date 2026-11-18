import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../lib/api';
import { KioskBankTransferModal } from './KioskBankTransferModal';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <svg data-testid="bank-transfer-qr" data-value={value} />,
}));

const details = {
  company_name: 'Voorbeeldbedrijf',
  accounts: [{ label: 'Suriname', value: '1234567890' }],
};
const payment = { amount: 125.5, currency: 'SRD', description: 'Huur 2026-11' };

async function withModal(check) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const location = Object.getOwnPropertyDescriptor(window, 'location');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL('https://kiosk.example.test/kiosk'),
  });
  try {
    await act(async () => root.render(<KioskBankTransferModal {...payment} />));
    check(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.defineProperty(window, 'location', location);
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

beforeEach(() => {
  api.get.mockResolvedValue({ data: details });
});

test('encodes a browser link on the kiosk host without embedding the payment details', async () => {
  const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
  api.post.mockResolvedValueOnce({ data: { token, bank_details: details } });
  await withModal((host) => {
    expect(api.post).toHaveBeenCalledWith('/kiosk/bank-details/share', payment, expect.anything());
    expect(host.querySelector('[data-testid="bank-transfer-qr"]').dataset.value)
      .toBe(`https://kiosk.example.test/bankgegevens#${token}`);
  });
});

test('keeps the account and manual confirmation available when sharing fails', async () => {
  api.post.mockRejectedValueOnce(new Error('Share unavailable'));
  await withModal((host) => {
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/handmatig kopiëren/);
    expect(host.querySelector('[data-testid="bank-transfer-account-0"]').textContent).toBe('1234567890');
    expect(host.querySelector('[data-testid="bank-transfer-done"]').disabled).toBe(false);
    expect(host.querySelector('[data-testid="bank-transfer-qr"]')).toBeNull();
  });
});
