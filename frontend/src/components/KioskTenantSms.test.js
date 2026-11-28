import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../lib/api';
import KioskTenantSms, { smsLength } from './KioskTenantSms';

jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatError: (error) => error.message,
  fmtMoney: (amount, currency) => `${currency} ${amount.toFixed(2)}`,
}));

const apartment = { tenant_id: 'tenant-1', number: '1' };
const Shell = ({ children }) => <div>{children}</div>;
const options = {
  tenant: { name: 'Huurder', phone: '+5971234567' },
  invoices: [{ id: 'invoice-1', invoice_number: 'F1', amount: 100, currency: 'SRD' }],
  payments: [{ id: 'payment-1', receipt_number: 'B1', amount: 100, currency: 'SRD' }],
};

async function withComponent(check) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<KioskTenantSms apartment={apartment} Shell={Shell} onClose={() => {}} />));
    await check(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: options });
  api.post.mockResolvedValue({ data: { ok: true } });
});

test('counts GSM extensions and Unicode as encoded SMS units', () => {
  expect(smsLength('a'.repeat(158) + '€')).toEqual({ length: 160, limit: 160 });
  expect(smsLength('😀'.repeat(35))).toEqual({ length: 70, limit: 70 });
});

test('sends a typed message and blocks messages exceeding one segment', async () => {
  await withComponent(async (host) => {
    const textarea = host.querySelector('textarea');
    const button = host.querySelector('[data-testid="tenant-sms-send"]');
    const type = async (value) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await type('a'.repeat(161));
    expect(button.disabled).toBe(true);
    expect(host.textContent).toContain('161/160');
    await type('Hallo huurder');
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(api.post).toHaveBeenCalledWith('/kiosk/tenants/tenant-1/sms', {
      action: 'message', document_id: null, message: 'Hallo huurder',
    });
    expect(host.querySelector('[role="status"]').textContent).toContain('nog niet bevestigd');
  });
});

test.each([
  ['invoice', 'invoice-1'], ['receipt', 'payment-1'], ['reminder', null], ['signature', null],
])('sends selected %s action', async (action, id) => {
  await withComponent(async (host) => {
    await act(async () => host.querySelector(`[data-testid="tenant-sms-action-${action}"]`).click());
    const button = host.querySelector('[data-testid="tenant-sms-send"]');
    if (id) {
      expect(button.disabled).toBe(true);
      await act(async () => {
        const select = host.querySelector('select');
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await act(async () => button.click());
    expect(api.post).toHaveBeenCalledWith('/kiosk/tenants/tenant-1/sms', {
      action, document_id: id, message: '',
    });
  });
});

test('shows sending errors and prevents sending without a phone number', async () => {
  api.get.mockResolvedValue({ data: { ...options, tenant: { ...options.tenant, phone: '' } } });
  await withComponent(async (host) => {
    expect(host.textContent).toContain('Voeg eerst een telefoonnummer toe');
    expect(host.querySelector('[data-testid="tenant-sms-send"]').disabled).toBe(true);
  });
  api.get.mockResolvedValue({ data: options });
  api.post.mockRejectedValue(new Error('Verzending mislukt'));
  await withComponent(async (host) => {
    await act(async () => host.querySelector('[data-testid="tenant-sms-action-reminder"]').click());
    await act(async () => host.querySelector('[data-testid="tenant-sms-send"]').click());
    expect(host.querySelector('[role="alert"]').textContent).toBe('Verzending mislukt');
  });
});
