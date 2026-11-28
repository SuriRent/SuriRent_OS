import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Companies from './Companies';
import { api } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ api: { get: jest.fn() }, formatError: String }));
jest.mock('../../../lib/auth', () => ({
  useAuth: () => ({ user: { role: 'superadmin' }, activeCompanyId: null }),
}));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));

test('shows and copies the selected company ID', async () => {
  api.get.mockImplementation((path) => Promise.resolve({
    data: path === '/companies' ? [{
      id: 'company-123', name: 'Voorbeeld', slug: 'voorbeeld',
      billing_status: 'active', active: true,
    }] : [],
  }));
  const writeText = jest.fn().mockResolvedValue();
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<Companies searchQuery="" statusFilter="all" />));
    await act(async () => host.querySelector('[data-testid="company-manage-voorbeeld"]').click());
    expect(host.querySelector('[data-testid="company-id"]').textContent).toBe('company-123');
    const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Kopieer bedrijfs-ID');
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledWith('company-123');
    expect(host.querySelector('[role="status"]').textContent).toBe('Bedrijfs-ID gekopieerd');
    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await act(async () => button.click());
    expect(host.querySelector('[role="status"]').textContent).toContain('kopieer deze handmatig');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else delete navigator.clipboard;
  }
});
