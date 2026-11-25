import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function MarketingWhatsAppButton() {
  const [number, setNumber] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/public/marketing-contact')
      .then(({ data }) => {
        if (active) setNumber(String(data.whatsapp || '').trim());
      })
      .catch((error) => console.error('WhatsApp-contactgegevens laden mislukt', error));
    return () => { active = false; };
  }, []);

  const digits = number.replace(/[\s()+.-]/g, '').replace(/^00/, '');
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;

  return (
    <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer"
      aria-label="Neem contact op via WhatsApp" title="WhatsApp ons"
      data-testid="marketing-whatsapp"
      className="fixed right-5 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_8px_30px_rgba(0,0,0,0.2)] transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-600 sm:right-8 sm:h-20 sm:w-20"
      style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-10 w-10 sm:h-12 sm:w-12">
        <path d="M20.52 3.48A11.88 11.88 0 0 0 12.06 0C5.49 0 .14 5.35.14 11.92c0 2.1.55 4.15 1.6 5.96L.05 24l6.26-1.64a11.9 11.9 0 0 0 5.75 1.46h.01c6.57 0 11.92-5.35 11.92-11.92 0-3.18-1.24-6.17-3.47-8.42ZM12.07 21.8a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.72.98.99-3.63-.23-.37a9.86 9.86 0 0 1-1.51-5.27c0-5.46 4.44-9.9 9.91-9.9a9.83 9.83 0 0 1 7 2.9 9.83 9.83 0 0 1 2.9 7c0 5.45-4.45 9.88-9.94 9.88Zm5.43-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.48-1.75-1.65-2.05-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.21 5.08 4.5.71.3 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35Z" />
      </svg>
    </a>
  );
}
