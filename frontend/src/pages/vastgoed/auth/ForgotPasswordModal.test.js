import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../../lib/api';
import ForgotPasswordModal from './ForgotPasswordModal';

jest.mock('../../../lib/api', () => ({
  api: { post: jest.fn() },
  formatError: (error) => error.message,
}));

test.each(['email', 'sms'])('wachtwoordherstel verstuurt via %s, niet WhatsApp', async (channel) => {
  api.post.mockResolvedValue({ data: { ok: true } });
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<ForgotPasswordModal initialEmail="user@example.com" onClose={() => {}} />));
    expect(host.querySelector('[data-testid="forgot-channel-whatsapp"]')).toBeNull();
    expect(host.querySelector('[data-testid="forgot-channel-sms"]').textContent).toBe('SMS');
    await act(async () => host.querySelector(`[data-testid="forgot-channel-${channel}"]`).click());
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.post).toHaveBeenLastCalledWith('/auth/forgot-password', { email: 'user@example.com', channel });
    expect(host.textContent).toContain(`Code verzonden via ${channel === 'email' ? 'e-mail' : 'SMS'}`);
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
