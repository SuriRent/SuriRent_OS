import { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';

const STORAGE_KEY = 'kiosk_color_mode';

export function useKioskColorMode() {
  const [colorMode, setColorMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'orange' ? 'orange' : 'white';
    } catch (error) {
      console.warn('Kioskmodus kon niet worden geladen.', error);
      return 'white';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, colorMode);
    } catch (error) {
      console.warn('Kioskmodus kon niet worden opgeslagen.', error);
    }
  }, [colorMode]);
  return [colorMode, setColorMode];
}

export function KioskThemeToggle({ colorMode, onChange }) {
  const isOrange = colorMode === 'orange';
  return (
    <button type="button" aria-label="Orange modus" aria-pressed={isOrange}
      title={isOrange ? 'Wissel naar White modus' : 'Wissel naar Orange modus'}
      data-testid="kiosk-color-mode-toggle"
      onClick={() => onChange(isOrange ? 'white' : 'orange')}
      className="kiosk-color-mode-toggle inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-2.5 text-xs font-bold text-orange-800 hover:bg-orange-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 lg:px-3">
      <Palette className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="hidden lg:inline">{isOrange ? 'Orange modus' : 'White modus'}</span>
    </button>
  );
}
