import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { formatError } from '../../lib/api';

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
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900 shadow-2xl md:grid-cols-[1fr_1.05fr]">
          <div className="flex flex-col justify-between bg-gradient-to-br from-emerald-500 via-emerald-700 to-slate-900 p-8 sm:p-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
              <ShieldCheck className="h-8 w-8" aria-hidden="true" />
            </div>
            <div className="py-12">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-100">SuriRent platformbeheer</p>
              <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">Superadmin</h1>
              <p className="mt-4 max-w-sm text-base leading-7 text-emerald-50/90">
                Beheer bedrijven, abonnementen en platforminstellingen vanuit uw eigen beveiligde omgeving.
              </p>
            </div>
            <p className="text-xs font-semibold text-emerald-100/70">Alleen toegankelijk voor SuriRent-superadmins.</p>
          </div>

          <div className="p-6 sm:p-12">
            <div className="mx-auto max-w-md py-4 sm:py-10">
              <p className="text-sm font-bold text-emerald-400">Welkom terug</p>
              <h2 className="mt-2 text-3xl font-black text-white">Inloggen op Superadmin</h2>
              <p className="mt-2 text-sm text-slate-400">Gebruik uw persoonlijke SuriRent-superadminaccount.</p>
              <p className="mt-2 text-xs text-slate-500">
                Geen superadmin-account? <Link to="/login?view=admin" className="font-bold text-emerald-400 hover:text-emerald-300">Ga naar de gewone login</Link>
              </p>

              {error && (
                <div role="alert" data-testid="superadmin-login-error"
                  className="mt-6 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              )}

              <form onSubmit={submit} className="mt-8 space-y-5">
                <div>
                  <label htmlFor="superadmin-email" className="mb-2 block text-sm font-bold text-slate-200">E-mailadres</label>
                  <input id="superadmin-email" data-testid="superadmin-email" type="email" autoComplete="username"
                    required value={email} onChange={(event) => setEmail(event.target.value)}
                    className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-white outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/10" />
                </div>
                <div>
                  <label htmlFor="superadmin-password" className="mb-2 block text-sm font-bold text-slate-200">Wachtwoord</label>
                  <div className="relative">
                    <input id="superadmin-password" data-testid="superadmin-password"
                      type={showPassword ? 'text' : 'password'} autoComplete="current-password" required
                      value={password} onChange={(event) => setPassword(event.target.value)}
                      className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 pr-12 text-white outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/10" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-white">
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={submitting}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 font-black text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? 'Bezig met inloggen…' : 'Inloggen op Superadmin'}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
