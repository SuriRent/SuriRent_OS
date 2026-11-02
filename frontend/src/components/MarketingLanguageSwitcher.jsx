import { useEditable } from '../lib/landing-editable';

const LANGUAGES = [
  { code: 'nl', flag: '🇳🇱', name: 'Nederlands' },
  { code: 'en', flag: '🇬🇧', name: 'English' },
];

export default function MarketingLanguageSwitcher() {
  const { language, setLanguage } = useEditable();

  return (
    <div role="group" aria-label={language === 'en' ? 'Website language' : 'Taal van de website'} className="inline-flex shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1">
      {LANGUAGES.map(({ code, flag, name }) => (
        <button
          key={code}
          type="button"
          onClick={() => setLanguage(code)}
          aria-label={name}
          aria-pressed={language === code}
          data-testid={`marketing-language-${code}`}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm transition-colors sm:h-8 sm:w-auto sm:gap-1.5 sm:px-2 ${
            language === code ? 'bg-orange-50 text-[#0B1B3F]' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <span aria-hidden="true">{flag}</span>
          <span className="sr-only sm:not-sr-only sm:text-xs sm:font-bold">{code.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
