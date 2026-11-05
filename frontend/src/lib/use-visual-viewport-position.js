import { useLayoutEffect } from 'react';

export default function useVisualViewportPosition(ref) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const viewport = window.visualViewport;
    let frame = 0;

    const update = () => {
      frame = 0;
      if (!element.isConnected) return;

      if (window.matchMedia('(min-width: 640px)').matches) {
        element.style.position = '';
        element.style.top = '';
        element.style.left = '';
        element.style.width = '';
        element.style.height = '';
        element.style.bottom = '';
        return;
      }

      element.style.position = 'absolute';
      element.style.top = `${Math.round(viewport?.offsetTop || 0)}px`;
      element.style.left = `${Math.round(viewport?.offsetLeft || 0)}px`;
      element.style.width = `${Math.round(viewport?.width || window.innerWidth)}px`;
      element.style.height = `${Math.round(viewport?.height || window.innerHeight)}px`;
      element.style.bottom = 'auto';
    };

    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    scheduleUpdate();
    if (viewport) {
      viewport.addEventListener('resize', scheduleUpdate);
      viewport.addEventListener('scroll', scheduleUpdate);
    }
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('orientationchange', scheduleUpdate);

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', scheduleUpdate);
        viewport.removeEventListener('scroll', scheduleUpdate);
      }
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref]);
}
