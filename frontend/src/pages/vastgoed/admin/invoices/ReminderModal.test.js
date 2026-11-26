import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReminderModal from './ReminderModal';
import { api } from '../../../../lib/api';

jest.mock('../../../../lib/api', () => ({
  api: { post: jest.fn() },
  formatError: (error) => error.message,
  fmtMoney: () => 'SRD 100',
}));
jest.mock('../../../../lib/use-visual-viewport-position', () => () => {});

test('stuurt de gekozen SMS-toon mee met de herinnering', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.post.mockResolvedValue({});
  try {
    await act(async () => root.render(
      <ReminderModal group={{ tenant_id: 't1', tenant_name: 'Huurder', openCount: 1, totalOpen: 100 }}
        initialChannel="sms" onClose={() => {}} onSent={() => {}} />,
    ));
    await act(async () => document.querySelector('[data-testid="reminder-tone-urgent"]').click());
    await act(async () => document.querySelector('[data-testid="reminder-send"]').click());
    expect(api.post).toHaveBeenCalledWith('/tenants/t1/reminder', expect.objectContaining({
      channel: 'sms', tone: 'urgent',
    }));
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
