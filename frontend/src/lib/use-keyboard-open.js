import { useEffect, useState } from 'react';

export default function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    const height = () => viewport ? viewport.height : window.innerHeight;

    let baseline = height();
    let isOpen = false;
    let frame = 0;

    const check = () => {
      frame = 0;
      const currentHeight = height();
      if (currentHeight > baseline) baseline = currentHeight;
      const difference = baseline - currentHeight;
      const next = isOpen ? difference > 80 : difference > 150;
      if (next !== isOpen) {
        isOpen = next;
        setOpen(next);
      }
    };

    const scheduleCheck = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    const onOrientationChange = () => {
      baseline = height();
      isOpen = false;
      setOpen(false);
      scheduleCheck();
    };

    if (viewport) {
      viewport.addEventListener('resize', scheduleCheck);
      viewport.addEventListener('scroll', scheduleCheck);
    }
    window.addEventListener('resize', scheduleCheck);
    window.addEventListener('orientationchange', onOrientationChange);
    scheduleCheck();

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', scheduleCheck);
        viewport.removeEventListener('scroll', scheduleCheck);
      }
      window.removeEventListener('resize', scheduleCheck);
      window.removeEventListener('orientationchange', onOrientationChange);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return open;
}
