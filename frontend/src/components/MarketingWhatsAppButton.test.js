import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../lib/api';
import MarketingWhatsAppButton from './MarketingWhatsAppButton';

jest.mock('../lib/api', () => ({ api: { get: jest.fn() } }));

test.each([
  ['+597 725-1674', 'https://wa.me/5977251674'],
  ['00597 7251674', 'https://wa.me/5977251674'],
  ['', null],
  ['597XXXXXXX', null],
])('uses the configured marketing contact %s', async (whatsapp, expectedHref) => {
  api.get.mockResolvedValue({ data: { whatsapp } });
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<MarketingWhatsAppButton />));
    expect(api.get).toHaveBeenCalledWith('/public/marketing-contact');
    const link = host.querySelector('a');
    if (expectedHref) {
      expect(link.getAttribute('href')).toBe(expectedHref);
      expect(link.getAttribute('aria-label')).toContain('WhatsApp');
      expect(link.getAttribute('rel')).toContain('noopener');
    } else {
      expect(link).toBeNull();
    }
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
