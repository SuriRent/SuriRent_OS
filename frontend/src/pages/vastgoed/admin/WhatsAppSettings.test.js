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
  expect(availableInstellingenSections({}).some((section) => section.id === 'messente')).toBe(true);
  api.get.mockResolvedValue({
    data: {
      messente: { enabled: true, api_username: null, api_password: null, whatsapp_from: '', sms_from: '', template_language: 'nl' },
      whatsapp_receipt_media_url: 'https://example.com/api/public/whatsapp-receipts/sample.jpg',
    },
  });
  api.post.mockResolvedValue({ data: { ok: true, detail: 'Testbericht verzonden' } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(RENDER.messente()));
    expect(host.querySelector('[data-testid="messente-username"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="messente-password"]').type).toBe('password');
    expect(host.querySelector('[data-testid="messente-receipt-media-url"]').textContent)
      .toBe('https://example.com/api/public/whatsapp-receipts/sample.jpg');
    const button = host.querySelector('[data-testid="settings-test"]');
    expect(button.disabled).toBe(true);
    const input = host.querySelector('[data-testid="messente-test-number"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '+5971234567');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(api.post).toHaveBeenCalledWith('/settings/messente/test', { to: '+5971234567', channel: 'whatsapp' });
    expect(host.textContent).toContain('Testbericht verzonden');
    const templateInput = host.querySelector('[data-testid="messente-receipt-template"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(templateInput, 'betaalbewijs');
      templateInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    api.put.mockResolvedValue({
      data: { data: { enabled: true, receipt_template: 'betaalbewijs' } },
    });
    await act(async () => host.querySelector('[data-testid="settings-save"]').click());
    expect(api.put).toHaveBeenCalledWith('/settings/messente', expect.objectContaining({
      receipt_template: 'betaalbewijs',
    }));
    await act(async () => {
      const select = host.querySelector('[data-testid="messente-test-template"]');
      select.value = 'receipt';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button.click());
    expect(api.post).toHaveBeenLastCalledWith('/settings/messente/test', {
      to: '+5971234567', channel: 'whatsapp', template_kind: 'receipt',
    });
    await act(async () => {
      const select = host.querySelector('[data-testid="messente-test-template"]');
      select.value = 'receipt_media';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button.click());
    expect(api.post).toHaveBeenLastCalledWith('/settings/messente/test', {
      to: '+5971234567', channel: 'whatsapp', template_kind: 'receipt_media',
    });
    await act(async () => {
      const select = host.querySelector('[data-testid="messente-test-channel"]');
      select.value = 'sms';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button.click());
    expect(api.post).toHaveBeenLastCalledWith('/settings/messente/test', { to: '+5971234567', channel: 'sms' });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
