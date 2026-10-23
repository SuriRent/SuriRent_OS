import { api } from './api';

// Na inloggen: beheerder/boekhouder gaat naar de kiosk in beheerdersmodus; superadmin naar /admin.
export async function enterKioskAfterLogin(user, { slug = '', fallback } = {}) {
  const goAdmin = () => (fallback ? fallback() : window.location.assign(slug ? `/${slug}/admin` : '/admin'));
  if (!user || user.role === 'superadmin') return goAdmin();
  try {
    const cid = localStorage.getItem('active_company_id');
    const { data } = await api.post('/auth/admin-to-kiosk', cid ? { company_id: cid } : {});
    if (!data?.token) return goAdmin();
    localStorage.setItem('kiosk_token', data.token);
    localStorage.setItem('kiosk_company', JSON.stringify(data.company || {}));
    localStorage.setItem('pwa_preferred_role', 'kiosk');
    if (!localStorage.getItem('admin_token')) localStorage.setItem('kiosk_admin_cookie', '1');
    window.location.assign('/kiosk');
  } catch {
    goAdmin();
  }
}

// Na e-mail+wachtwoord: eerst verplicht een persoonlijke PIN (behalve superadmin), dan door.
export async function afterPasswordLogin(user, { fallback, onNeedPin }) {
  const proceed = () => enterKioskAfterLogin(user, { fallback });
  if (user?.role !== 'superadmin') {
    let hasPin = true;
    try { hasPin = !!(await api.get('/auth/personal-pin/status')).data?.has_pin; } catch { /* ignore */ }
    if (!hasPin) { onNeedPin(proceed); return; }
  }
  await proceed();
}
