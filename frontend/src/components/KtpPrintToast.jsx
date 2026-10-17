import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

// Alleen print-opdrachten die vanaf dít toestel zijn verstuurd krijgen een melding.
const jobs = new Map();
const NO_ACK_MS = 20000;

// Ack kan via de WebSocket binnenkomen vóór het HTTP-antwoord met job_id: kort bufferen.
const early = new Map();

export function trackKtpJob(jobId, printerName) {
  if (!jobId) return;
  const buffered = early.get(jobId);
  if (buffered) {
    early.delete(jobId);
    jobs.set(jobId, { printerName, timer: null });
    // Opnieuw uitsturen zodat ook de knop-status (job.current is nu gezet) het oppikt.
    setTimeout(() => window.dispatchEvent(new CustomEvent('ktp-remote-print-done', { detail: buffered })), 0);
    return;
  }
  const timer = setTimeout(() => {
    if (!jobs.has(jobId)) return;
    jobs.delete(jobId);
    window.dispatchEvent(new CustomEvent('ktp-toast', { detail: { ok: false, msg: `Geen antwoord van ${printerName || 'de KT-V520'}` } }));
  }, NO_ACK_MS);
  jobs.set(jobId, { printerName, timer });
}

window.addEventListener('ktp-remote-print-done', (e) => {
  const d = e.detail || {};
  const job = jobs.get(d.job_id);
  if (!job) {
    if (d.job_id && !early.has(d.job_id)) {
      early.set(d.job_id, d);
      setTimeout(() => early.delete(d.job_id), 30000);
    }
    return;
  }
  clearTimeout(job.timer);
  jobs.delete(d.job_id);
  const name = d.printer || job.printerName || 'KT-V520';
  window.dispatchEvent(new CustomEvent('ktp-toast', {
    detail: d.ok
      ? { ok: true, name, msg: `Bon geprint op ${name}` }
      : { ok: false, msg: `Printen mislukt op ${name}${d.error ? ` — ${d.error}` : ''}` },
  }));
});

export function KtpPrintToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    let t;
    const onToast = (e) => {
      clearTimeout(t);
      // Meerdere printers tegelijk: namen samenvoegen in één groene balk.
      setToast((prev) => (prev?.ok && e.detail?.ok && e.detail.name && !prev.names.includes(e.detail.name)
        ? { ...prev, names: [...prev.names, e.detail.name], msg: `Bon geprint op ${[...prev.names, e.detail.name].join(' en ')}` }
        : { ...e.detail, names: e.detail?.name ? [e.detail.name] : [], key: Date.now() }));
      t = setTimeout(() => setToast(null), e.detail?.ok ? 4000 : 6000);
    };
    window.addEventListener('ktp-toast', onToast);
    return () => { window.removeEventListener('ktp-toast', onToast); clearTimeout(t); };
  }, []);
  if (!toast) return null;
  const Icon = toast.ok ? CheckCircle2 : AlertTriangle;
  return createPortal(
    <div key={toast.key} role="status" onClick={() => setToast(null)}
      data-testid={toast.ok ? 'ktp-print-toast-ok' : 'ktp-print-toast-error'}
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)' }}
      className={`fixed top-0 inset-x-0 z-[10050] animate-in slide-in-from-top duration-300 ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'} text-white shadow-lg`}>
      <div className="flex items-center justify-center gap-2 px-4 py-3 text-sm sm:text-base font-bold">
        <Icon className="w-5 h-5 shrink-0" />
        <span data-testid="ktp-print-toast-msg">{toast.msg}</span>
      </div>
    </div>,
    document.body,
  );
}
