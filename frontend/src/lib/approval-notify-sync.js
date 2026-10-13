import { useEffect, useCallback } from 'react';
import { api } from './api';
import { useAdminEvents } from './admin-events';

// Sluit OS-meldingen "Goedkeuring nodig" zodra de betaling is goedgekeurd
// (op dit of een ander apparaat), zodat ze niet blijven hangen.
async function getApprovalNotifications() {
  if (!('serviceWorker' in navigator)) return [];
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.getNotifications) return [];
    const list = await reg.getNotifications();
    return list.filter((n) => n.data?.payment_id && (n.data.require_approval || n.data.kind === 'payment_pending_approval'));
  } catch { return []; }
}

export async function closeApprovalNotification(paymentId) {
  (await getApprovalNotifications()).forEach((n) => { if (n.data.payment_id === paymentId) n.close(); });
}

async function syncApprovalNotifications() {
  const open = await getApprovalNotifications();
  if (!open.length) return;
  try {
    const { data } = await api.get('/payments/pending-ids');
    const pending = new Set(data?.ids || []);
    open.forEach((n) => { if (!pending.has(n.data.payment_id)) n.close(); });
  } catch { /* offline — volgende keer */ }
}

export function useApprovalNotifySync({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    syncApprovalNotifications();
    const onVis = () => { if (document.visibilityState === 'visible') syncApprovalNotifications(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled]);
  const onEvent = useCallback((evt) => {
    if (evt?.type === 'change' && String(evt.path || '').includes('/payments')) syncApprovalNotifications();
  }, []);
  useAdminEvents(onEvent, { enabled });
}
