import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Subscriptions from './Subscriptions';
import { api } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ api: { get: jest.fn() }, formatError: String }));
jest.mock('../../../lib/auth', () => ({ useAuth: () => ({ activeCompanyId: 'company-1' }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));

test('payment topbar filters scoped payments on desktop and mobile', async () => {
  const payments = [
    { id: 'cash', company_id: 'company-1', company_name: 'Cash', method: 'contant', amount: 10 },
    { id: 'bank', company_id: 'company-1', company_name: 'Bank', method: 'bank', source: 'ocr', amount: 20 },
    { id: 'other', company_id: 'company-2', company_name: 'Other', method: 'bank', amount: 30 },
  ];
  api.get.mockImplementation((url) => Promise.resolve({
    data: url === '/superadmin/overview' ? {} : url === '/superadmin/subscription-payments' ? payments : [],
  }));
  const host = document.createElement('div');
  const desktop = document.createElement('div');
  const mobile = document.createElement('div');
  document.body.append(host, desktop, mobile);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(
      <Subscriptions viewMode="payments" paymentTopbar={desktop} paymentMobileTopbar={mobile} paymentTopbarActive />,
    ));
    expect(desktop.querySelector('[data-testid="saas-pay-filter-all"]').textContent).toContain('2');
    expect(mobile.querySelector('[data-testid="saas-pay-mobile-filter-ocr"]').textContent).toContain('1');
    expect(host.textContent).not.toContain('Ontvangen betalingen van klanten.');
    await act(async () => desktop.querySelector('[data-testid="saas-pay-filter-contant"]').click());
    expect(host.querySelector('[data-testid="sub-payment-cash"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="sub-payment-bank"]')).toBeNull();
    await act(async () => mobile.querySelector('[data-testid="saas-pay-mobile-filter-ocr"]').click());
    expect(host.querySelector('[data-testid="sub-payment-cash"]')).toBeNull();
    expect(host.querySelector('[data-testid="sub-payment-bank"]')).not.toBeNull();
    await act(async () => root.render(
      <Subscriptions viewMode="payments" paymentTopbar={desktop} paymentMobileTopbar={mobile} paymentTopbarActive={false} />,
    ));
    expect(desktop.textContent).toBe('');
    expect(mobile.textContent).toBe('');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    desktop.remove();
    mobile.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test('invoice topbar filters scoped invoices and opens the create dialog', async () => {
  const invoices = [
    { id: 'open', company_id: 'company-1', company_name: 'Open', status: 'open', due_date: '2099-12-10', amount: 10 },
    { id: 'paid', company_id: 'company-1', company_name: 'Paid', status: 'paid', amount: 20 },
    { id: 'late', company_id: 'company-1', company_name: 'Late', status: 'open', due_date: '2020-12-10', amount: 30 },
    { id: 'other', company_id: 'company-2', company_name: 'Other', status: 'paid', amount: 40 },
  ];
  api.get.mockImplementation((url) => Promise.resolve({
    data: url === '/superadmin/overview' ? {} : url === '/superadmin/subscription-invoices' ? invoices : [],
  }));
  const host = document.createElement('div');
  const desktop = document.createElement('div');
  const mobile = document.createElement('div');
  document.body.append(host, desktop, mobile);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(
      <Subscriptions viewMode="invoices" invoiceTopbar={desktop} invoiceMobileTopbar={mobile} invoiceTopbarActive />,
    ));
    expect(desktop.querySelector('[data-testid="saas-inv-filter-all"]').textContent).toContain('3');
    expect(desktop.querySelector('[data-testid="saas-inv-filter-open"]').textContent).toContain('1');
    expect(mobile.querySelector('[data-testid="saas-inv-mobile-filter-overdue"]').textContent).toContain('1');
    expect(host.textContent).not.toContain('Facturen die SuriRent N.V. uitstuurt aan klanten.');
    await act(async () => desktop.querySelector('[data-testid="saas-inv-filter-paid"]').click());
    expect(host.querySelector('[data-testid="sub-invoice-paid"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="sub-invoice-open"]')).toBeNull();
    await act(async () => mobile.querySelector('[data-testid="saas-inv-mobile-filter-overdue"]').click());
    expect(host.querySelector('[data-testid="sub-invoice-late"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="sub-invoice-paid"]')).toBeNull();
    await act(async () => desktop.querySelector('[data-testid="new-invoice-btn"]').click());
    expect(host.querySelector('[data-testid="new-invoice-modal"]')).not.toBeNull();
    await act(async () => host.querySelector('[data-testid="new-inv-close"]').click());
    await act(async () => mobile.querySelector('[data-testid="new-invoice-mobile-btn"]').click());
    expect(host.querySelector('[data-testid="new-invoice-modal"]')).not.toBeNull();
    await act(async () => root.render(
      <Subscriptions viewMode="invoices" invoiceTopbar={desktop} invoiceMobileTopbar={mobile} invoiceTopbarActive={false} />,
    ));
    expect(desktop.textContent).toBe('');
    expect(mobile.textContent).toBe('');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    desktop.remove();
    mobile.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
