import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useEditable } from '../lib/landing-editable';

const NAVY = '#0B1B3F';
const LANGUAGES = [
  ['nl', 'Nederlands'],
  ['en', 'English'],
];

function Flag({ lang }) {
  if (lang === 'nl') {
    return <span className="w-6 h-6 rounded-full overflow-hidden flex flex-col shadow-inner shrink-0"><span className="flex-1 bg-[#AE1C28]" /><span className="flex-1 bg-white" /><span className="flex-1 bg-[#21468B]" /></span>;
  }
  return (
    <span className="w-6 h-6 rounded-full overflow-hidden relative bg-[#012169] shrink-0">
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[6px] bg-white" /><span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[6px] bg-white" />
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] bg-[#C8102E]" /><span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-[#C8102E]" />
    </span>
  );
}

export default function MarketingLanguageSwitcher() {
  const { language, setLanguage } = useEditable();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} data-testid="marketing-language-toggle"
        aria-haspopup="menu" aria-expanded={open}
        aria-label={language === 'en' ? 'Website language' : 'Taal van de website'}
        className="h-10 px-3 rounded-2xl bg-white shadow-[0_6px_18px_-10px_rgba(11,27,63,0.35)] flex items-center gap-2 text-sm font-bold" style={{ color: NAVY }}>
        <Flag lang={language} />{language.toUpperCase()}<ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-40 rounded-xl bg-white shadow-[0_18px_40px_-16px_rgba(11,27,63,0.35)] p-1.5 z-50" role="menu" data-testid="marketing-language-menu">
          {LANGUAGES.map(([code, name]) => (
            <button key={code} type="button" role="menuitem" onClick={() => { setLanguage(code); setOpen(false); }} data-testid={`marketing-language-${code}`}
              className={`w-full h-10 px-2.5 rounded-lg flex items-center gap-2.5 text-sm font-bold hover:bg-orange-50 ${language === code ? 'text-[#FF5C00]' : ''}`} style={language === code ? undefined : { color: NAVY }}>
              <Flag lang={code} />{name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
