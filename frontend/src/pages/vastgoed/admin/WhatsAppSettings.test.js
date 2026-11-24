import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../../lib/api';
import { availableInstellingenSections } from './instellingenSections';
import { RENDER } from './InstellingenHub';

jest.mock('react-router-dom', () => ({
  useLocation: jest.fn(),
  useNavigate: jest.fn(),
  useSearchParams: jest.fn(),
  Link: () => null,
}));
jest.mock('../../../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  formatError: (error) => error?.message || 'Fout',
}));
jest.mock('../../../lib/swr', () => ({
  readSeed: () => null,
  writeSeed: (key, data) => data,
  prefetchApi: jest.fn(),
}));
jest.mock('../../../lib/auto-refresh', () => ({ useAutoRefresh: jest.fn() }));

test('WhatsApp-instellingen zijn bereikbaar en testen een opgegeven ontvanger', async () => {
  expect(availableInstellingenSections({}).some((section) => section.id === 'twilio')).toBe(true);
  api.get.mockResolvedValue({
    data: { twilio: { enabled: true, account_sid: '', auth_token: null, whatsapp_from: '', sms_from: '' } },
  });
  api.post.mockResolvedValue({ data: { ok: true, detail: 'Testbericht verzonden' } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(RENDER.twilio()));
    expect(host.querySelector('[data-testid="twilio-sid"]')).not.toBeNull();
    const button = host.querySelector('[data-testid="settings-test"]');
    expect(button.disabled).toBe(true);
    const input = host.querySelector('[data-testid="twilio-test-number"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '+5971234567');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(api.post).toHaveBeenCalledWith('/settings/twilio/test', { to: '+5971234567' });
    expect(host.textContent).toContain('Testbericht verzonden');
    const sidInput = host.querySelector('[data-testid="twilio-receipt-sid"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(sidInput, `HX${'a'.repeat(32)}`);
      sidInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    api.put.mockResolvedValue({
      data: { data: { enabled: true, receipt_content_sid: `HX${'a'.repeat(32)}` } },
    });
    await act(async () => host.querySelector('[data-testid="settings-save"]').click());
    expect(api.put).toHaveBeenCalledWith('/settings/twilio', expect.objectContaining({
      receipt_content_sid: `HX${'a'.repeat(32)}`,
    }));
    await act(async () => {
      const select = host.querySelector('[data-testid="twilio-test-template"]');
      select.value = 'receipt';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button.click());
    expect(api.post).toHaveBeenLastCalledWith('/settings/twilio/test', {
      to: '+5971234567', template_kind: 'receipt',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
