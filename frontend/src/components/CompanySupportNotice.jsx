import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';

export default function CompanySupportNotice({ kiosk = false, onActiveChange }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let mounted = true;
    const checkStatus = async () => {
      try {
        const path = kiosk ? '/kiosk/support-status' : '/companies/me/support-status';
        const { data } = await api.get(path);
        if (!mounted) return;
        const isActive = data?.active === true;
        setActive(isActive);
        onActiveChange?.(isActive);
      } catch (error) {
        if (!mounted) return;
        if (error?.response?.status === 401) {
          setActive(false);
          onActiveChange?.(false);
        } else {
          console.warn('Supportstatus kon niet worden gecontroleerd:', error);
        }
      }
    };

    checkStatus();
    const timer = window.setInterval(checkStatus, 15000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [kiosk, onActiveChange]);

  if (!active) return null;

  return (
    <div
      className={`flex items-center justify-center gap-2 bg-amber-100 px-3 text-center text-xs font-bold text-amber-950 ${kiosk ? 'h-full' : ''}`}
      data-testid="company-support-notice"
    >
      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
      <span>SuriRent N.V. is actief in deze klantomgeving voor ondersteuning.</span>
    </div>
  );
}
