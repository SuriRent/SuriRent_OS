import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import KioskBankDetailsPage from './KioskBankDetailsPage';

jest.mock('react-router-dom', () => ({ useLocation: jest.fn() }));
jest.mock('../../lib/api', () => ({
  ...jest.requireActual('../../lib/api'),
  api: { post: jest.fn() },
}));

const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';

async function withPage(check) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<KioskBankDetailsPage />));
    check(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

test('opens the bank details and transfer reference from the scanned link', async () => {
  useLocation.mockReturnValue({ hash: `#${token}` });
  api.post.mockResolvedValue({ data: {
    company_name: 'Voorbeeldbedrijf',
    accounts: [{ label: 'Suriname', value: '1234567890' }],
    amount: 125.5, currency: 'SRD', description: 'Huur 2026-11',
  } });
  await withPage((host) => {
    expect(api.post).toHaveBeenCalledWith('/public/kiosk-bank-details', { token }, expect.anything());
    expect(host.querySelector('[data-testid="bank-transfer-amount"]').textContent).toBe('SRD 125,50');
    expect(host.querySelector('[data-testid="bank-transfer-account-0"]').textContent).toBe('1234567890');
    expect(host.querySelector('[data-testid="bank-transfer-description"]').textContent).toBe('Huur 2026-11');
    expect(host.textContent).not.toContain('Overboeking gedaan');
  });
});

test('tells the user to scan again if the link has expired', async () => {
  useLocation.mockReturnValue({ hash: `#${token}` });
  api.post.mockRejectedValue({ response: { status: 404 } });
  await withPage((host) => {
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/verlopen.*Scan een nieuwe QR-code/);
    expect(host.querySelector('[data-testid="bank-transfer-account-0"]')).toBeNull();
  });
});
