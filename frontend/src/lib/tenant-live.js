let source = null;
let retryTimer = null;
let started = false;

function dispatchRefresh() {
  window.dispatchEvent(new CustomEvent('surirent:tenant-live-change'));
}

function connect() {
  if (!started || source || !localStorage.getItem('tenant_token')) return;
  const apiBase = `${process.env.REACT_APP_BACKEND_URL}/api`;
  const token = localStorage.getItem('tenant_token');
  const url = `${apiBase}/tenant-portal/events?token=${encodeURIComponent(token)}`;
  try {
    source = new EventSource(url, { withCredentials: true });
    source.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === 'change') dispatchRefresh();
      } catch { /* malformed event is ignored; the stream remains open */ }
    };
    source.onerror = () => {
      if (source) source.close();
      source = null;
      if (started && !retryTimer) retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, 2000);
    };
  } catch {
    if (started && !retryTimer) retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, 2000);
  }
}

function onVisible() {
  if (document.visibilityState !== 'visible' || !started) return;
  dispatchRefresh();
  if (source) {
    source.close();
    source = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  connect();
}

export function startTenantLive() {
  if (started || !localStorage.getItem('tenant_token')) return;
  started = true;
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);
  connect();
}

export function stopTenantLive() {
  started = false;
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onVisible);
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (source) source.close();
  source = null;
}
