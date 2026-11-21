import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../lib/api';
import { PrintChoiceMenu } from './PrintChoiceMenu';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../lib/bt-printer', () => ({
  getSavedPrinter: () => null,
  printLinesBluetooth: jest.fn(),
  useBtReady: () => false,
}));
jest.mock('../lib/ktp-printer', () => ({ isKtpDevice: () => false, otherPrinters: () => [] }));
jest.mock('./KtpPrintToast', () => ({ trackKtpJob: jest.fn() }));

beforeEach(() => {
  api.get.mockResolvedValue({ data: [] });
});

test('offers local receipt printing even when no kiosk printer is configured', async () => {
  const onLocal = jest.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(
      <PrintChoiceMenu paymentId="kasgeld-entry-1" showLocal onLocal={onLocal} onStatus={jest.fn()} />,
    ));
    await act(async () => host.querySelector('[data-testid="history-print-kasgeld-entry-1"]').click());
    const localButton = document.querySelector('[data-testid="history-print-local-kasgeld-entry-1"]');
    expect(localButton.textContent).toContain('Print op dit apparaat');
    await act(async () => localButton.click());
    expect(onLocal).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
