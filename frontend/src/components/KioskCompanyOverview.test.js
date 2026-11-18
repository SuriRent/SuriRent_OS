import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { KioskCompanyOverview, parseUtilityAmount } from './KioskCompanyOverview';
import { api } from '../lib/api';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  api: { get: jest.fn(), put: jest.fn() },
}));

test('accepts a decimal comma and distinguishes zero from an unset amount', () => {
  expect(parseUtilityAmount(' 50,25 ')).toBe(50.25);
  expect(parseUtilityAmount('0')).toBe(0);
  expect(parseUtilityAmount('')).toBeNull();
  expect(() => parseUtilityAmount('50,255')).toThrow();
});

test('shows company totals and saves the edited utility amounts', async () => {
  api.get.mockResolvedValue({ data: {
    company_id: 'company-a', can_edit_utilities: true,
    paid: { SRD: 800, USD: 100 }, outstanding: { SRD: 600 }, overdue: { SRD: 200 },
    utilities: { ebs: 100, swm: 0 },
  } });
  api.put.mockResolvedValue({ data: { utilities: { ebs: 175.5, swm: 0, telesur: null } } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<KioskCompanyOverview Shell={({ children }) => children} onClose={jest.fn()} />));
    expect(host.querySelector('[data-testid="kiosk-overview-paid"]').textContent).toContain('USD 100,00');
    expect(host.querySelector('[data-testid="kiosk-overview-outstanding"]').textContent).toContain('SRD 600,00');
    expect(host.querySelector('[data-testid="kiosk-overview-overdue"]').textContent).toContain('SRD 200,00');
    const input = host.querySelector('#utility-ebs');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '175,50');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.put).toHaveBeenCalledWith('/admin/kiosk-utility-amounts', { company_id: 'company-a', ebs: 175.5, swm: 0, telesur: null });
    expect(host.textContent).toContain('Bedragen opgeslagen');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
