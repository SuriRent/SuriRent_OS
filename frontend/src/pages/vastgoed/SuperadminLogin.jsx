import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { formatError } from '../../lib/api';
import LoginHeader from './auth/LoginHeader';

export default function SuperadminLogin() {
  const navigate = useNavigate();
  const { user, loading: authLoading, loginSuperadmin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && user?.role === 'superadmin') navigate('/admin', { replace: true });
  }, [authLoading, navigate, user]);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await loginSuperadmin(email.trim(), password);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(formatError(err, 'Inloggen mislukt. Controleer uw gegevens.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F3F8F5] px-4 pb-8 text-slate-900 sm:px-6">
      <div className="-mx-4 bg-[#101827] sm:-mx-6"
        style={{ paddingTop: 'var(--kiosk-sat, env(safe-area-inset-top, 0px))' }}>
        <LoginHeader branding={{ app_name: 'SuriRent Superadmin', tagline: 'Platformbeheer' }} />
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center py-5">
        <section className="w-full rounded-3xl bg-white px-6 py-8 shadow-[0_20px_60px_rgba(0,0,0,0.18)] sm:px-12 sm:py-10">
          <div className="mx-auto max-w-xl">
            <div className="mb-5 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-700 shadow-lg shadow-emerald-700/20">
                <ShieldCheck className="h-7 w-7 text-white" aria-hidden="true" />
              </div>
              <h1 className="text-3xl font-black tracking-tight text-slate-900" data-testid="superadmin-login-title">
                Superadmin Login
              </h1>
              <p className="mt-1 text-sm text-slate-500">Log in op het SuriRent-platformbeheer</p>
            </div>
            <p className="mb-6 text-center text-xs text-slate-500">
              Geen superadmin-account? <Link to="/login?view=admin" className="font-bold text-emerald-700 hover:text-emerald-800 hover:underline">Naar gewone login</Link>
            </p>

            {error && (
              <div role="alert" data-testid="superadmin-login-error"
                className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="superadmin-email" className="mb-2 block text-sm font-bold text-slate-700">E-mailadres</label>
                <input id="superadmin-email" data-testid="superadmin-email" type="email" autoComplete="username"
                  required value={email} onChange={(event) => setEmail(event.target.value)}
                  className="h-14 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-600/10" />
              </div>
              <div>
                <label htmlFor="superadmin-password" className="mb-2 block text-sm font-bold text-slate-700">Wachtwoord</label>
                <div className="relative">
                  <input id="superadmin-password" data-testid="superadmin-password"
                    type={showPassword ? 'text' : 'password'} autoComplete="current-password" required
                    value={password} onChange={(event) => setPassword(event.target.value)}
                    className="h-14 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 pr-12 text-base text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-600/10" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-slate-700">
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={submitting}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-lg font-black text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-800 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60">
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {submitting ? 'Bezig met inloggen…' : 'Inloggen'}
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
