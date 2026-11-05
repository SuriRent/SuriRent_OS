import { useCallback, useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';

export function KioskImageViewer({ url, filename, onClose, testId = 'kiosk-image-viewer' }) {
  const backPending = useRef(false);
  const historyEntry = useRef(false);
  const close = useCallback(() => {
    if (window.history.state?.__surirentImageViewer && !backPending.current) {
      backPending.current = true;
      window.history.back();
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!historyEntry.current) {
      window.history.pushState({ ...(window.history.state || {}), __surirentImageViewer: true }, '');
      historyEntry.current = true;
    }
    const closeOnBack = () => onClose();
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('popstate', closeOnBack);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('popstate', closeOnBack);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [close, onClose]);

  return (
    <div className="fixed inset-0 z-[160] bg-black/70 backdrop-blur-sm flex flex-col"
      role="dialog" aria-modal="true" aria-label="Bon bekijken" data-testid={testId}>
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-white shadow">
        <h2 className="font-bold text-slate-900">Bon bekijken</h2>
        <div className="flex items-center gap-2">
          <a href={url} download={filename}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold text-sm">
            <Download className="w-4 h-4" /> Download JPG
          </a>
          <button type="button" onClick={close} aria-label="Bon sluiten" data-testid={`${testId}-close`}
            className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-4">
        <img src={url} alt="Bon" className="max-w-full h-auto bg-white shadow-xl" />
      </div>
    </div>
  );
}
