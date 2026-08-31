import { Delete } from 'lucide-react';

/**
 * NumPad — inline numeriek toetsenbord voor bedragen.
 *
 * Voordelen boven het native OS-toetsenbord:
 *  - Opent nooit het iPhone/Android keyboard → geen viewport-shift
 *  - Grote knoppen, POS-terminal look, snelle bediening
 *  - Ondersteunt 0-9, decimale punt en backspace
 *
 * Props:
 *  - value: huidige string-waarde (bijv. "1500" of "1500.50")
 *  - onChange: (nieuwe string) => void
 *  - allowDecimal: standaard true, zet false voor whole-numbers-only
 *  - maxDecimals: max aantal decimalen na de punt (default 2)
 *  - testIdPrefix: prefix voor data-testid attributen
 */
export default function NumPad({ value = '', onChange, allowDecimal = true, maxDecimals = 2, testIdPrefix = 'npad' }) {
  const press = (ch) => {
    const cur = String(value || '');
    if (ch === '⌫') {
      onChange(cur.slice(0, -1));
      return;
    }
    if (ch === '.') {
      if (!allowDecimal || cur.includes('.')) return;
      onChange(cur === '' ? '0.' : cur + '.');
      return;
    }
    // Cijfer
    if (cur.includes('.')) {
      const [, dec = ''] = cur.split('.');
      if (dec.length >= maxDecimals) return;
    }
    // Vervang leading "0" wanneer gebruiker een cijfer typt, tenzij er al
    // een decimale punt aanwezig is.
    if (cur === '0' && ch !== '0') {
      onChange(ch);
    } else {
      onChange(cur + ch);
    }
  };

  const keys = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    allowDecimal ? '.' : '00', '0', '⌫',
  ];

  return (
    <div className="grid grid-cols-3 gap-2" data-testid={`${testIdPrefix}-grid`}>
      {keys.map((k) => {
        const isBackspace = k === '⌫';
        const isSpecial = k === '.' || k === '00';
        return (
          <button key={k} type="button"
            onClick={() => press(k)}
            data-testid={`${testIdPrefix}-key-${k === '⌫' ? 'back' : k === '.' ? 'dot' : k}`}
            className={`h-14 rounded-2xl font-black text-2xl transition active:scale-95 select-none touch-manipulation ${
              isBackspace
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center'
                : isSpecial
                  ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                  : 'bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm'
            }`}>
            {isBackspace ? <Delete className="w-6 h-6" /> : k}
          </button>
        );
      })}
    </div>
  );
}
