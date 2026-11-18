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

const expense = { id: 'cash-a', amount: 100, description: 'EBS rekening', entry_date: '2026-11-12' };

function mockOverview(editCompany) {
  api.get.mockImplementation((path, config) => {
    if (path === '/admin/kiosk-utility-amounts') return Promise.resolve({ data: { company_id: editCompany } });
    if (path === '/admin/kiosk-utility-expenses') return Promise.resolve({ data: [expense] });
    const period = config.params.period || '2026-11';
    return Promise.resolve({ data: {
      company_id: 'company-a', period, current_period: '2026-11',
      paid: { SRD: 800, USD: 100 }, outstanding: { SRD: 600 }, overdue: { SRD: 200 },
      utilities: period === '2026-11' ? { ebs: 100, swm: 0 } : {},
      utility_payments: { ebs: [], swm: [], telesur: [] },
    } });
  });
}

async function withOverview(assertions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<KioskCompanyOverview Shell={({ children }) => children} onClose={jest.fn()} />));
    await assertions(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
}

test('uses the separate administrator session to enable editing and saving', async () => {
  mockOverview('company-a');
  api.put.mockResolvedValue({ data: { utilities: { ebs: 175.5, swm: 0, telesur: null } } });
  await withOverview(async (host) => {
    expect(api.get).toHaveBeenCalledWith('/kiosk/company-overview', expect.anything());
    expect(api.get).toHaveBeenCalledWith('/admin/kiosk-utility-amounts', expect.anything());
    expect(host.querySelector('[data-testid="kiosk-overview-paid"]').textContent).toContain('USD 100,00');
    expect(host.querySelector('[data-testid="kiosk-overview-outstanding"]').textContent).toContain('SRD 600,00');
    expect(host.querySelector('[data-testid="kiosk-overview-overdue"]').textContent).toContain('SRD 200,00');
    const input = host.querySelector('#utility-ebs');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '175,50');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.put).toHaveBeenCalledWith('/admin/kiosk-utility-amounts', { company_id: 'company-a', period: '2026-11', ebs: 175.5, swm: 0, telesur: null });
    expect(host.textContent).toContain('Bedragen opgeslagen');
  });
});

test('links and unlinks an existing expense without posting a new cash entry', async () => {
  mockOverview('company-a');
  api.put.mockClear().mockResolvedValue({ data: { ok: true } });
  await withOverview(async (host) => {
    const provider = host.querySelector('#utility-ebs').closest('section');
    const select = provider.querySelector('select');
    await act(async () => {
      select.value = expense.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => provider.querySelector('button').click());
    const body = { company_id: 'company-a', period: '2026-11', provider: 'ebs', entry_id: expense.id };
    expect(api.put).toHaveBeenNthCalledWith(1, '/admin/kiosk-utility-expenses', { ...body, linked: true });
    expect(provider.textContent).toContain('Voldaan');
    expect(provider.textContent).toContain('Nog te betalen: SRD 0,00');
    await act(async () => provider.querySelector('button').click());
    expect(api.put).toHaveBeenNthCalledWith(2, '/admin/kiosk-utility-expenses', { ...body, linked: false });
    expect(provider.textContent).toContain('Nog te betalen: SRD 100,00');
  });
});

test('switches months without carrying over the utility amount', async () => {
  mockOverview('company-a');
  await withOverview(async (host) => {
    const input = host.querySelector('input[type="month"]');
    expect(input.value).toBe('2026-11');
    expect(host.querySelector('#utility-ebs').value).toBe('100');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-10');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(api.get).toHaveBeenCalledWith('/kiosk/company-overview', expect.objectContaining({ params: { period: '2026-10' } }));
    expect(host.querySelector('#utility-ebs').value).toBe('');
  });
});

test.each([null, 'company-b'])('keeps the amounts read-only for edit scope %s', async (editCompany) => {
  mockOverview(editCompany);
  await withOverview((host) => {
    expect(host.querySelector('#utility-ebs')).toBeNull();
    expect(host.textContent).toContain('SRD 100,00');
    expect(host.textContent).toContain('Alleen een beheerder of eigenaar van dit bedrijf');
    expect(host.textContent).not.toContain('Bedragen opslaan');
  });
});
