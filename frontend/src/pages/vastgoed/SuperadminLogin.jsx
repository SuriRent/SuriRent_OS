import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete, KeyRound, LayoutDashboard, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { formatError } from '../../lib/api';
import { setIosStatusBar } from '../../lib/ios-status-bar';

const NUMPAD_LETTERS = {
  2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL',
  6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ',
};

export default function SuperadminLogin() {
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const { user, loading: authLoading, loginSuperadminPin } = useAuth();
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && user?.role === 'superadmin') navigate('/admin', { replace: true });
  }, [authLoading, navigate, user]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const previousHtmlColor = document.documentElement.style.backgroundColor;
    const previousBodyColor = document.body.style.backgroundColor;
    const themeColors = [...document.querySelectorAll('meta[name="theme-color"]')]
      .map((meta) => meta.getAttribute('content'));
    document.documentElement.style.backgroundColor = '#F3F8F5';
    document.body.style.backgroundColor = '#F3F8F5';
    setIosStatusBar('#F3F8F5');
    return () => {
      document.documentElement.style.backgroundColor = previousHtmlColor;
      document.body.style.backgroundColor = previousBodyColor;
      document.querySelectorAll('meta[name="theme-color"]').forEach((meta, index) => {
        if (themeColors[index]) meta.setAttribute('content', themeColors[index]);
      });
    };
  }, []);

  const verifyPin = async (value) => {
    setSubmitting(true);
    setError('');
    try {
      await loginSuperadminPin(value);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(formatError(err, 'Ongeldige pincode. Probeer opnieuw.'));
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKey = (key) => {
    if (submitting) return;
    setError('');
    if (key === 'DEL') {
      setPin((current) => current.slice(0, -1));
      return;
    }
    if (!/^\d$/.test(key) || pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) verifyPin(next);
  };

  const onKeyboardInput = (event) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      handleKey(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      handleKey('DEL');
    }
  };

  const keypad = (mobile = false) => (
    <div role="group" aria-label="Pincode toetsenbord"
      className={`grid grid-cols-3 ${mobile ? 'mt-6 w-[min(340px,88%)]' : 'mx-auto mt-5 w-full max-w-xs'} ${
      mobile ? 'gap-x-6 gap-y-1' : 'gap-2'
    }`}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '_empty', '0', 'DEL'].map((key) => (
        key === '_empty' ? <div key={key} /> : (
          <button key={key} type="button" onClick={() => handleKey(key)} disabled={submitting}
            aria-label={key === 'DEL' ? 'Laatste cijfer verwijderen' : key}
            data-testid={`superadmin-keypad-${key}`}
            className={mobile
              ? 'flex h-[clamp(54px,8vh,70px)] flex-col items-center justify-center rounded-2xl border border-emerald-200/80 bg-white/80 text-emerald-900 shadow-sm transition hover:bg-white active:scale-95 disabled:opacity-50'
              : 'flex h-14 flex-col items-center justify-center rounded-xl border border-emerald-100 bg-slate-50 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 active:scale-95 disabled:opacity-50'}>
            {key === 'DEL' ? (
              <Delete className={mobile ? 'h-7 w-7 text-emerald-700' : 'h-5 w-5 text-slate-600'} />
            ) : (
              <>
                <span className={`font-black leading-none ${mobile ? 'text-3xl' : 'text-2xl text-slate-900'}`}>{key}</span>
                {NUMPAD_LETTERS[key] && (
                  <span className={`mt-0.5 text-[9px] font-bold tracking-[0.18em] ${
                    mobile ? 'text-emerald-700/70' : 'text-slate-400'
                  }`}>{NUMPAD_LETTERS[key]}</span>
                )}
              </>
            )}
          </button>
        )
      ))}
    </div>
  );

  const pinDots = (mobile = false) => (
    <div className="mt-5 flex items-center justify-center gap-5"
      aria-label={`${pin.length} van 4 pincodecijfers ingevoerd`}>
      {[0, 1, 2, 3].map((index) => {
        const color = error ? 'bg-red-400 scale-110'
          : index < pin.length ? 'bg-emerald-700 scale-110'
            : (mobile ? 'bg-emerald-200' : 'bg-slate-200');
        return <span key={index} data-testid={`superadmin-pin-dot-${index}`}
          className={`h-4 w-4 rounded-full transition-all ${color}`} />;
      })}
    </div>
  );

  const status = (
    <>
      {error && <p role="alert" data-testid="superadmin-login-error"
        className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-sm font-bold text-red-700">
        {error}
      </p>}
      {submitting && <div className="mt-4 flex items-center justify-center gap-2 text-sm font-bold text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" /> Pincode controleren…
      </div>}
    </>
  );

  return (
    <main ref={panelRef} tabIndex={-1} onKeyDown={onKeyboardInput}
      className="fixed inset-0 flex flex-col overflow-y-auto bg-[#F3F8F5] outline-none"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Desktop: white PIN card on the superadmin dashboard background. */}
      <div className="hidden min-h-full flex-1 items-center justify-center bg-[#F3F8F5] p-8 lg:flex">
        <section className="w-full max-w-md rounded-3xl bg-white px-8 py-9 shadow-[0_20px_60px_rgba(15,23,42,0.12)]"
          data-testid="superadmin-pin-desktop">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-700 shadow-lg shadow-emerald-700/20">
              <KeyRound className="h-7 w-7 text-white" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900" data-testid="superadmin-login-title">
              SuriRent N.V.
            </h1>
            <p className="mt-1 text-sm text-slate-500">Voer uw 4-cijferige pincode in</p>
          </div>
          {pinDots()}
          {status}
          {keypad()}
          <p className="mt-6 border-t border-slate-100 pt-4 text-center text-xs font-medium text-slate-400">
            Beveiligde toegang tot het SuriRent-platform
          </p>
        </section>
      </div>

      {/* Mobiel: full-screen kiosk-PIN ervaring. */}
      <div className="relative flex min-h-full flex-1 flex-col items-center overflow-hidden bg-[#F3F8F5] text-slate-900 lg:hidden"
        data-testid="superadmin-pin-mobile">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-emerald-200/50 blur-3xl" />
          <div className="absolute -left-32 top-1/3 h-80 w-80 rounded-full bg-emerald-100/80 blur-3xl" />
          <svg className="absolute inset-0 h-full w-full opacity-[0.06]" preserveAspectRatio="none" viewBox="0 0 400 800">
            <path d="M0,200 Q200,150 400,250 L400,300 Q200,200 0,250 Z" fill="#047857" />
            <path d="M0,360 Q200,310 400,410 L400,460 Q200,360 0,410 Z" fill="#047857" />
          </svg>
        </div>
        <div className="relative z-10 flex min-h-full w-full flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-6">
          <h1 className="text-center text-4xl font-black tracking-tight text-slate-900" data-testid="superadmin-login-title-mobile">
            Welkom
          </h1>
          <div className="relative mt-5">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-700 text-white shadow-xl shadow-emerald-900/20">
              <LayoutDashboard className="h-12 w-12" aria-hidden="true" />
            </div>
            <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-[#F3F8F5] bg-emerald-500" />
          </div>
          <p className="mt-4 text-center text-sm font-black uppercase tracking-wider text-emerald-900">SuriRent N.V.</p>
          <p className="mt-2 text-center text-sm font-medium text-slate-600">Voer uw 4-cijferige pincode in</p>
          {pinDots(true)}
          {error && <p role="alert" data-testid="superadmin-login-error"
            className="mt-4 rounded-full border border-red-200 bg-red-50 px-5 py-2 text-center text-xs font-bold text-red-700 shadow-sm">{error}</p>}
          {submitting && <div className="mt-3 flex items-center gap-2 text-sm font-bold text-emerald-800">
            <Loader2 className="h-4 w-4 animate-spin" /> Controleren…
          </div>}
          {keypad(true)}
          <p className="mt-5 text-center text-xs font-medium text-slate-500">
            Beveiligde toegang tot het SuriRent-platform
          </p>
        </div>
      </div>
    </main>
  );
}
