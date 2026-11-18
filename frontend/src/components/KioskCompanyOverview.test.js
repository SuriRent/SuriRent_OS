import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { KioskCompanyOverview } from './KioskCompanyOverview';
import { api } from '../lib/api';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  api: { get: jest.fn() },
}));

test('shows only financial totals and reloads them for the selected month', async () => {
  api.get.mockImplementation((path, { params }) => {
    if (path !== '/kiosk/company-overview') throw new Error(`Unexpected request: ${path}`);
    const period = params.period || '2026-11';
    return Promise.resolve({ data: {
      period, current_period: '2026-11',
      paid: { USD: period === '2026-11' ? 100 : 75 },
      outstanding: { SRD: 600 }, overdue: { SRD: 200 },
    } });
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<KioskCompanyOverview Shell={({ children }) => children} onClose={jest.fn()} />));
    const paid = () => host.querySelector('[data-testid="kiosk-overview-paid"]').textContent;
    expect(paid()).toContain('USD 100,00');
    expect(host.querySelector('[data-testid="kiosk-overview-outstanding"]').textContent).toContain('SRD 600,00');
    expect(host.querySelector('[data-testid="kiosk-overview-overdue"]').textContent).toContain('SRD 200,00');
    expect(host.textContent).not.toMatch(/Vaste lasten|EBS|SWM|Telesur/);
    const month = host.querySelector('input[type="month"]');
    expect(month.value).toBe('2026-11');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(month, '2026-10');
      month.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(api.get).toHaveBeenLastCalledWith('/kiosk/company-overview', expect.objectContaining({ params: { period: '2026-10' } }));
    expect(paid()).toContain('USD 75,00');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
