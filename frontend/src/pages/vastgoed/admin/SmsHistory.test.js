import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../../lib/api';
import SmsHistory from './SmsHistory';

jest.mock('../../../lib/api', () => ({
  api: { get: jest.fn() },
  formatError: () => 'Ophalen mislukt',
}));

test('toont afleverstatus en ververst het SMS-overzicht', async () => {
  api.get.mockResolvedValueOnce({ data: [{
    purpose: 'Betaalbewijs', to: '+5971234567', status: 'accepted', created_at: '2026-01-01T10:00:00Z',
  }] }).mockResolvedValueOnce({ data: [{
    purpose: 'Betaalbewijs', to: '+5971234567', status: 'DELIVRD', created_at: '2026-01-01T10:00:00Z',
  }] });
  const host = document.createElement('div');
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<SmsHistory />));
    expect(host.textContent).toContain('Aangenomen door Messente');
    expect(host.textContent).toContain('+5971234567');
    await act(async () => host.querySelector('button').click());
    expect(host.textContent).toContain('Afgeleverd');
    expect(api.get).toHaveBeenLastCalledWith('/sms/history');
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
