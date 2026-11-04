import { useCallback, useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';

export function KioskPdfViewer({ url, filename, onClose, testId = 'kiosk-pdf-viewer' }) {
  const backPending = useRef(false);
  const historyEntry = useRef(false);
  const close = useCallback(() => {
    if (window.history.state?.__surirentPdfViewer && !backPending.current) {
      backPending.current = true;
      window.history.back();
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!historyEntry.current) {
      window.history.pushState({ ...(window.history.state || {}), __surirentPdfViewer: true }, '');
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
      role="dialog" aria-modal="true" aria-label="PDF bekijken" data-testid={testId}>
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-white shadow">
        <h2 className="font-bold text-slate-900">PDF bekijken</h2>
        <div className="flex items-center gap-2">
          <a href={url} download={filename}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold text-sm">
            <Download className="w-4 h-4" /> Download
          </a>
          <button type="button" onClick={close} aria-label="PDF sluiten" data-testid={`${testId}-close`}
            className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>
      <iframe src={url} title="PDF bekijken" className="flex-1 w-full border-0 bg-slate-200" />
    </div>
  );
}
