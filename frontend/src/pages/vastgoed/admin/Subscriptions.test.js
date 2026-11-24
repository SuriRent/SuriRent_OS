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
