import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { KioskThemeToggle, useKioskColorMode } from './KioskThemeToggle';

function TestKiosk() {
  const [colorMode, setColorMode] = useKioskColorMode();
  return <KioskThemeToggle colorMode={colorMode} onChange={setColorMode} />;
}

test('defaults to White modus and restores Orange modus after reopening', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const previousEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.removeItem('kiosk_color_mode');
  let root = createRoot(host);
  try {
    await act(async () => root.render(<TestKiosk />));
    const button = () => host.querySelector('button');
    expect(button().textContent).toBe('White modus');
    await act(async () => button().click());
    expect(button().textContent).toBe('Orange modus');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<TestKiosk />));
    expect(button().textContent).toBe('Orange modus');
    await act(async () => button().click());
    expect(button().textContent).toBe('White modus');
    expect(button().getAttribute('aria-pressed')).toBe('false');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.removeItem('kiosk_color_mode');
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousEnvironment;
  }
});
