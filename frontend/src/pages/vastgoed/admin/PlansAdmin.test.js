import { act } from 'react';
import { createRoot } from 'react-dom/client';
import PlansAdmin from './PlansAdmin';
import { api } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ api: { get: jest.fn() }, formatError: String }));

test('shows four-column plan grid and opens a new plan on each topbar request', async () => {
  api.get.mockResolvedValue({
    data: ['starter', 'standard', 'professional', 'enterprise'].map((id) => ({
      id, name: id, amount: 10, currency: 'SRD', active: true,
    })),
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<PlansAdmin createRequest={0} />));
    const grid = host.querySelector('[data-testid="plan-grid"]');
    expect(grid.className).toContain('xl:grid-cols-4');
    expect(grid.querySelectorAll('[data-testid^="plan-card-"]')).toHaveLength(4);
    expect(host.textContent).not.toContain('Bepaal welke abonnementen klanten kunnen kiezen');
    await act(async () => root.render(<PlansAdmin createRequest={1} />));
    expect(host.querySelector('[data-testid="plan-card-new"]')).not.toBeNull();
    await act(async () => host.querySelector('[data-testid="plan-cancel-new"]').click());
    expect(host.querySelector('[data-testid="plan-card-new"]')).toBeNull();
    await act(async () => root.render(<PlansAdmin createRequest={2} />));
    expect(host.querySelector('[data-testid="plan-card-new"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
