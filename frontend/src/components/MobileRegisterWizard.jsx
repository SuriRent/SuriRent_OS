import { useEffect } from 'react';
import {
  ArrowLeft, ArrowRight, Building2, Check, Eye, EyeOff, Globe, Loader2,
  Lock, Mail, MapPin, Phone, Sparkles, User, X,
} from 'lucide-react';
import { useRegisterWizard } from './MobileAuthShell';
import PasswordStrength from './PasswordStrength';

const STEPS = ['Bedrijf', 'Persoon', 'Account', 'Pakket'];
const TITLES = ['Je bedrijf', 'Jouw gegevens', 'Inloggegevens', 'Kies je pakket'];
const SUBTITLES = [
  'Vertel ons over je verhuurbedrijf.',
  'Wie wordt het aanspreekpunt?',
  'Gebruik je e-mailadres om straks in te loggen.',
  'Kies je land en pakket. Je start met 14 dagen gratis.',
];

const inputClass = 'h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#FF5C00] focus:ring-4 focus:ring-orange-100';

function LabeledInput({ id, label, icon: Icon, children, optional }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-bold text-slate-700">
        {label} {optional
          ? <span className="font-medium text-slate-400">(optioneel)</span>
          : <span className="text-[#FF5C00]">*</span>}
      </label>
      <div className="relative">
        <Icon className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        {children}
      </div>
    </div>
  );
}

export default function MobileRegisterWizard({ onClose, primary = '#FF5C00', initialPlan }) {
  const {
    step, companyName, setCompanyName, address, setAddress, name, setName,
    telefoon, setTelefoon, email, setEmail, password, setPassword, showPw,
    setShowPw, country, setCountry, plan, setPlan, plans, loading, error,
    success, chosenPlanName, portalPreview, slugStatus, stepValid, next, prev,
    goToPortal,
  } = useRegisterWizard({ onClose, initialPlan });

  useEffect(() => {
    const previousHtmlColor = document.documentElement.style.backgroundColor;
    const previousBodyColor = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = primary;
    document.body.style.backgroundColor = primary;
    return () => {
      document.documentElement.style.backgroundColor = previousHtmlColor;
      document.body.style.backgroundColor = previousBodyColor;
    };
  }, [primary]);

  const shellStyle = {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    backgroundColor: primary,
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    paddingLeft: 'env(safe-area-inset-left, 0px)',
    paddingRight: 'env(safe-area-inset-right, 0px)',
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#FF5C00] px-4 py-6" style={shellStyle}>
        <div className="w-full max-w-md rounded-3xl bg-white p-7 text-center text-[#0B1B3F] shadow-2xl sm:p-9">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <Check className="h-9 w-9 text-emerald-500" strokeWidth={3} />
          </div>
          <h1 className="text-3xl font-black tracking-tight">Welkom!</h1>
          <p className="mt-2 font-bold text-[#FF5C00]">{companyName}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
            Je vastgoed-omgeving is aangemaakt. Je kunt nu 14 dagen gratis aan de slag.
          </p>
          <button type="button" onClick={goToPortal} data-testid="register-success-continue"
            className="mt-7 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5C00] text-base font-black text-white shadow-lg shadow-orange-200 transition active:scale-[0.98]">
            Naar mijn dashboard <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-[#FF5C00] text-white" style={shellStyle} data-testid="register-mobile">
      <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-white/15 blur-3xl" />
      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col px-4">
        <header className="flex shrink-0 items-center justify-between py-3">
          <button type="button" onClick={prev} data-testid="register-back"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/30 bg-white/15 px-3 text-sm font-bold text-white backdrop-blur-sm">
            <ArrowLeft className="h-4 w-4" />
            {step === 0 ? 'Sluiten' : 'Vorige'}
          </button>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white p-1 shadow">
              <img src="/kiosk-icons/kiosk-192.png" alt="" className="h-full w-full object-contain" />
            </span>
            <span className="font-black tracking-tight text-white">SuriRent</span>
          </div>
          <button type="button" onClick={onClose} data-testid="register-close" aria-label="Sluiten"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/30 bg-white/15 text-white backdrop-blur-sm">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="shrink-0 px-1 pb-3 pt-1" data-testid="register-stepper">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-white/90">
            <span>Stap {step + 1} van {STEPS.length}</span>
            <span>{STEPS[step]}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5" aria-label={`Stap ${step + 1} van ${STEPS.length}`}>
            {STEPS.map((label, index) => (
              <span key={label} data-testid={`register-stepper-${index}`}
                className={`h-1.5 rounded-full transition-colors ${index <= step ? 'bg-white' : 'bg-white/30'}`} />
            ))}
          </div>
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-3xl bg-[#FBF8F5] text-[#0B1B3F] shadow-[0_20px_60px_-24px_rgba(11,27,63,0.45)]">
          <div className="shrink-0 px-5 pb-4 pt-5 sm:px-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#FF5C00]">{STEPS[step]}</p>
                <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight sm:text-3xl" data-testid="register-title">{TITLES[step]}</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{SUBTITLES[step]}</p>
              </div>
              {step === 3 && (
                <span className="mt-1 shrink-0 rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-black text-[#E65300]">
                  14 dagen gratis
                </span>
              )}
            </div>
            {chosenPlanName && step !== 3 && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1.5 text-xs font-bold text-[#E65300]" data-testid="chosen-plan-badge">
                <Sparkles className="h-3.5 w-3.5" /> Je koos: {chosenPlanName}
              </div>
            )}
          </div>

          <div key={step} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-7" style={{ WebkitOverflowScrolling: 'touch' }}>
            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert" data-testid="register-error">
                {error}
              </div>
            )}

            {step === 0 && (
              <div className="space-y-4">
                <button type="button" onClick={() => {
                    const redirectUrl = window.location.origin + '/auth/callback';
                    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
                  }}
                  data-testid="register-google-btn"
                  className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-800 shadow-sm transition active:scale-[0.99]">
                  <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.48 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Snel registreren met Google
                </button>
                <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" /> Of vul je gegevens in <span className="h-px flex-1 bg-slate-200" />
                </div>
                <LabeledInput id="register-company" label="Bedrijfsnaam" icon={Building2}>
                  <input id="register-company" type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                    data-testid="register-company" autoComplete="organization" required placeholder="Bijv. Demo Vastgoed N.V." className={inputClass} />
                </LabeledInput>
                {portalPreview.slug && (
                  <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold ${
                    slugStatus === 'taken' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  }`} data-testid="register-slug-preview">
                    <Globe className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate font-mono">{portalPreview.host || 'app.surirent.sr'}/{portalPreview.slug}</span>
                    {slugStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin" />}
                    {slugStatus === 'available' && <span>Vrij</span>}
                    {slugStatus === 'taken' && <span>Bezet</span>}
                  </div>
                )}
                <LabeledInput id="register-address" label="Adres" icon={MapPin} optional>
                  <input id="register-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)}
                    data-testid="register-address" autoComplete="street-address" placeholder="Straat, huisnummer en plaats" className={inputClass} />
                </LabeledInput>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <LabeledInput id="register-name" label="Voor- en achternaam" icon={User}>
                  <input id="register-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
                    data-testid="register-name" autoComplete="name" required placeholder="Bijv. Anita Sewdas" className={inputClass} />
                </LabeledInput>
                <LabeledInput id="register-phone" label="Telefoonnummer" icon={Phone} optional>
                  <input id="register-phone" type="tel" value={telefoon} onChange={(e) => setTelefoon(e.target.value)}
                    data-testid="register-phone" autoComplete="tel" inputMode="tel" placeholder="+597 880 1001" className={inputClass} />
                </LabeledInput>
                <p className="rounded-xl bg-orange-50 p-3 text-xs leading-relaxed text-slate-600">We gebruiken je telefoonnummer alleen voor support en belangrijke meldingen.</p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <LabeledInput id="register-email" label="E-mailadres" icon={Mail}>
                  <input id="register-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    data-testid="register-email" autoComplete="email" inputMode="email" required placeholder="naam@bedrijf.sr" className={inputClass} />
                </LabeledInput>
                <LabeledInput id="register-password" label="Wachtwoord" icon={Lock}>
                  <input id="register-password" type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                    data-testid="register-password" minLength={6} autoComplete="new-password" required placeholder="Minimaal 6 tekens"
                    className={`${inputClass} pr-14`} />
                  <button type="button" onClick={() => setShowPw((visible) => !visible)}
                    aria-label={showPw ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
                    className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500">
                    {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </LabeledInput>
                <div className="px-1"><PasswordStrength password={password} variant="light" /></div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <fieldset>
                  <legend className="mb-2 text-sm font-bold text-slate-700">Land en valuta</legend>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      { code: 'SR', flag: '🇸🇷', label: 'Suriname', sub: 'SRD' },
                      { code: 'NL', flag: '🇳🇱', label: 'Nederland', sub: 'EUR' },
                    ].map((item) => {
                      const selected = country === item.code;
                      return (
                        <button key={item.code} type="button" onClick={() => setCountry(item.code)}
                          data-testid={`register-country-${item.code.toLowerCase()}`} aria-pressed={selected}
                          className={`flex h-14 items-center justify-center gap-2 rounded-xl border-2 transition ${
                            selected ? 'border-[#FF5C00] bg-orange-50 text-[#0B1B3F]' : 'border-slate-200 bg-white text-slate-700'
                          }`}>
                          <span className="text-xl">{item.flag}</span>
                          <span className="text-left leading-tight">
                            <span className="block text-sm font-extrabold">{item.label}</span>
                            <span className="text-[11px] text-slate-500">{item.sub}</span>
                          </span>
                          {selected && <Check className="h-4 w-4 text-[#FF5C00]" />}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-sm font-bold text-slate-700">Kies je pakket</legend>
                  {plans.length === 0 ? (
                    <div className="flex min-h-24 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
                      <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#FF5C00]" /> Pakketten laden...
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {plans.map((item) => {
                        const selected = plan === item.id;
                        const currency = (item.currency || 'SRD').toUpperCase();
                        const amount = currency === 'EUR'
                          ? `€${Number(item.amount).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : `${currency} ${Number(item.amount).toLocaleString('nl-NL')}`;
                        const billingLabel = item.interval === 'lifetime'
                          ? 'eenmalig'
                          : item.interval === 'year'
                            ? 'per jaar'
                            : 'per maand';
                        return (
                          <button key={item.id} type="button" onClick={() => setPlan(item.id)}
                            data-testid={`register-plan-${item.id}`} aria-pressed={selected}
                            className={`w-full rounded-xl border-2 p-3.5 text-left transition ${
                              selected ? 'border-[#FF5C00] bg-orange-50' : 'border-slate-200 bg-white'
                            }`}>
                            <span className="flex min-w-0 items-center justify-between gap-3">
                              <span className="min-w-0 break-words font-extrabold text-[#0B1B3F]">{item.name}</span>
                              {selected && <Check className="h-5 w-5 shrink-0 text-[#FF5C00]" strokeWidth={2.5} />}
                            </span>
                            {item.description && (
                              <span className="mt-1 block whitespace-normal break-words text-xs leading-relaxed text-slate-600">{item.description}</span>
                            )}
                            <span className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                              <span className="text-lg font-black text-[#FF5C00]">{Number(item.amount) === 0 ? 'Gratis' : amount}</span>
                              {Number(item.amount) !== 0 && <span className="text-xs text-slate-500">{billingLabel}</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              </div>
            )}
          </div>

          <footer className="shrink-0 border-t border-slate-200 bg-white px-5 pb-3 pt-3 sm:px-7">
            <button type="button" onClick={next} disabled={!stepValid || loading} data-testid="register-next"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5C00] text-base font-black text-white shadow-lg shadow-orange-200 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45">
              {loading ? <><Loader2 className="h-5 w-5 animate-spin" /> Account aanmaken...</> : (
                <>{step < 3 ? 'Verder' : 'Account aanmaken'}<ArrowRight className="h-5 w-5" /></>
              )}
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              {step < 3 ? 'Je gegevens blijven bewaard als je teruggaat.' : '14 dagen gratis proberen'}
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
