import { useLayoutEffect } from 'react';

export default function useVisualViewportPosition(ref, mobileBreakpoint = 640, options = {}) {
  const { settleDelay = 0, pinToTop = false } = options;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const viewport = window.visualViewport;
    let frame = 0;
    let updateTimer = 0;

    const update = () => {
      frame = 0;
      if (!element.isConnected) return;

      if (window.matchMedia(`(min-width: ${mobileBreakpoint}px)`).matches) {
        element.style.position = '';
        element.style.top = '';
        element.style.left = '';
        element.style.width = '';
        element.style.height = '';
        element.style.bottom = '';
        element.style.removeProperty('--visual-viewport-height');
        return;
      }

      const height = Math.round(viewport?.height || window.innerHeight);
      element.style.position = 'absolute';
      element.style.top = pinToTop ? '0px' : `${Math.round(viewport?.offsetTop || 0)}px`;
      element.style.left = `${Math.round(viewport?.offsetLeft || 0)}px`;
      element.style.width = `${Math.round(viewport?.width || window.innerWidth)}px`;
      element.style.height = `${height}px`;
      element.style.bottom = 'auto';
      element.style.setProperty('--visual-viewport-height', `${height}px`);
    };

    const scheduleFrame = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    const scheduleUpdate = () => {
      if (settleDelay > 0) {
        window.clearTimeout(updateTimer);
        updateTimer = window.setTimeout(scheduleFrame, settleDelay);
      } else {
        scheduleFrame();
      }
    };

    scheduleFrame();
    if (viewport) {
      viewport.addEventListener('resize', scheduleUpdate);
      if (!pinToTop) viewport.addEventListener('scroll', scheduleUpdate);
    }
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('orientationchange', scheduleUpdate);

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', scheduleUpdate);
        if (!pinToTop) viewport.removeEventListener('scroll', scheduleUpdate);
      }
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', scheduleUpdate);
      window.clearTimeout(updateTimer);
      if (frame) window.cancelAnimationFrame(frame);
      element.style.removeProperty('--visual-viewport-height');
    };
  }, [ref, mobileBreakpoint, settleDelay, pinToTop]);
}
