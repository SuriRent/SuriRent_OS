import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, formatError } from '../lib/api';
import { KioskImageViewer } from './KioskImageViewer';

export function KioskReceiptImageButton({ paymentId, filename, testId, className, children }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const close = useCallback(() => setUrl(''), []);

  useEffect(() => {
    if (!url) return undefined;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  const open = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/payments/${paymentId}/image`, { responseType: 'blob' });
      setUrl(URL.createObjectURL(new Blob([data], { type: 'image/jpeg' })));
    } catch (e) {
      setError(formatError(e, 'Bon openen mislukt'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" onClick={open} disabled={loading} data-testid={testId}
        aria-label="Bon bekijken" title="Bon bekijken" className={className}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : children}
      </button>
      {error && <span role="alert" className="text-xs font-semibold text-red-600">{error}</span>}
      {url && (
        <KioskImageViewer url={url} filename={filename} onClose={close} testId={`${testId}-viewer`} />
      )}
    </>
  );
}
