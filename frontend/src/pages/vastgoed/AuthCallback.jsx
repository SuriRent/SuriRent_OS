// AuthCallback — verwerkt Emergent Google OAuth callback.
import { enterKioskAfterLogin } from '../../lib/kioskEntry';
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS,
// THIS BREAKS THE AUTH. Redirect URL wordt afgeleid van window.location.origin
// door LoginPage.
import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export default function AuthCallback() {
  const nav = useNavigate();
  const loc = useLocation();
  const processed = useRef(false);

  useEffect(() => {
    // Synchroon flaggen zodat StrictMode geen dubbele exchange doet.
    if (processed.current) return;
    processed.current = true;
    const hash = loc.hash || '';
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) { nav('/login', { replace: true }); return; }
    const sessionId = decodeURIComponent(m[1]);
    // Wis de fragment direct zodat een refresh 'm niet herhaalt.
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* noop */ }

    const backend = process.env.REACT_APP_BACKEND_URL;
    fetch(`${backend}/api/auth/google/callback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const user = await r.json();
        enterKioskAfterLogin(user?.user || user, { fallback: () => nav('/admin', { replace: true, state: { user } }) });
      })
      .catch(() => {
        nav('/login', { replace: true, state: { error: 'Google login mislukt — probeer opnieuw.' } });
      });
  }, [loc.hash, nav]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center" data-testid="auth-callback">
        <Loader2 className="w-10 h-10 text-orange-500 animate-spin mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-700">Inloggen met Google…</p>
      </div>
    </div>
  );
}
