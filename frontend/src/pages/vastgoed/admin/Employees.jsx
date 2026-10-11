import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, X, Check, Loader2, FileText, Users as UsersIcon, Trash2, Pencil, Receipt, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../../lib/api';
import { useApiSWR } from '../../../lib/swr';
import KeyboardSafeModal from '../../../components/KeyboardSafeModal';

function EmpActions({ e, load, onPin, onEdit, onDelete }) {
  const btn = 'inline-flex items-center justify-center w-10 h-10 md:w-8 md:h-8 rounded-lg';
  const toggleAi = async () => {
    try {
      await api.put(`/assistant/employees/${e.id}/access`, { enabled: !e.ai_assistant_enabled });
      await load();
    } catch (ex) { alert(formatError(ex)); }
  };
  return (
    <div className="inline-flex items-center gap-1">
      <button onClick={toggleAi} data-testid={`emp-ai-toggle-${e.id}`} title={e.ai_assistant_enabled ? 'AI-assistent uit' : 'AI-assistent aan'}
        className={`${btn} ${e.ai_assistant_enabled ? 'bg-orange-50 hover:bg-orange-100 text-[#FF5C00]' : 'bg-slate-50 hover:bg-slate-100 text-slate-400'}`}>
        <Sparkles className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => onPin(e)} data-testid={`emp-pin-${e.id}`} title={e.has_kiosk_pin ? 'PIN wijzigen' : 'PIN instellen'}
        className={`${btn} ${e.has_kiosk_pin ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700' : 'bg-amber-50 hover:bg-amber-100 text-amber-700'}`}>
        <KeyRound className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => onEdit(e)} data-testid={`emp-edit-${e.id}`} className={`${btn} bg-slate-100 hover:bg-slate-200 text-slate-600`}>
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => onDelete(e.id)} data-testid={`emp-delete-${e.id}`} className={`${btn} bg-red-50 hover:bg-red-100 text-red-500`}>
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function EmployeeForm({ initial, onCancel, onSaved }) {
  const [data, setData] = useState(() => ({
    name: '', role: '', app_role: 'admin', phone: '', email: '', monthly_salary: 0, currency: 'SRD', active: true,
    ...(initial || {}), password: '', pin: '',
  }));
  const isNew = !initial?.id;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    if (isNew && !/^\d{4}$/.test(data.pin)) { setError('PIN is verplicht (precies 4 cijfers).'); return; }
    if (data.pin && !/^\d{4}$/.test(data.pin)) { setError('PIN moet uit precies 4 cijfers bestaan.'); return; }
    if (data.password && data.password.length < 6) { setError('Wachtwoord moet minimaal 6 tekens zijn.'); return; }
    if (data.password && !data.email.trim()) { setError('Vul een e-mailadres in om een login aan te maken.'); return; }
    setLoading(true);
    try {
      const { id, created_at, has_kiosk_pin, has_login, ai_assistant_enabled, ...rest } = data;
      const payload = { ...rest, monthly_salary: parseFloat(data.monthly_salary) || 0,
        password: data.password || null, pin: data.pin || null };
      if (initial?.id) {
        const { data: r } = await api.put(`/employees/${initial.id}`, payload);
        onSaved(r);
      } else {
        const { data: r } = await api.post('/employees', payload);
        onSaved(r);
      }
    } catch (e) { setError(formatError(e)); }
    finally { setLoading(false); }
  };
  const APP_ROLES = [
    { value: 'admin', label: 'Beheerder', desc: 'Volledige toegang, betalingen direct geboekt' },
    { value: 'boekhouder', label: 'Boekhouder', desc: 'Betalingen direct geboekt, financiën' },
    { value: 'kiosk', label: 'Kiosk medewerker', desc: 'Betalingen via kiosk → goedkeuring vereist' },
  ];
  return (
    <KeyboardSafeModal onClose={onCancel} testId="employee-modal" maxWidthClass="sm:max-w-lg">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">{initial ? 'Werknemer bewerken' : 'Nieuwe werknemer'}</h3>
          <button onClick={onCancel} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        {error && <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Naam *</label>
            <input value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} data-testid="emp-name" required
              className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5 block">Systeemrol *</label>
            <div className="grid grid-cols-1 gap-2">
              {APP_ROLES.map((r) => (
                <button key={r.value} type="button" onClick={() => setData({ ...data, app_role: r.value })}
                  data-testid={`emp-approle-${r.value}`}
                  className={`text-left p-3 rounded-xl border-2 transition ${data.app_role === r.value ? 'border-[#FF5C00] bg-orange-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-sm text-slate-900">{r.label}</p>
                    {data.app_role === r.value && <Check className="w-4 h-4 text-[#FF5C00]" />}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{r.desc}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Functie / titel (optioneel)</label>
            <input value={data.role} onChange={(e) => setData({ ...data, role: e.target.value })} data-testid="emp-role"
              placeholder="Bv. Receptionist, Kassier…"
              className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Telefoon</label>
              <input value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} data-testid="emp-phone"
                className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">E-mail</label>
              <input type="email" value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} data-testid="emp-email"
                className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
          </div>
          <LoginFields data={data} setData={setData} isNew={isNew} hasLogin={initial?.has_login} />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Maandsalaris</label>
              <input type="number" step="0.01" value={data.monthly_salary} onChange={(e) => setData({ ...data, monthly_salary: e.target.value })}
                data-testid="emp-salary"
                className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Valuta</label>
              <select value={data.currency} onChange={(e) => setData({ ...data, currency: e.target.value })} data-testid="emp-currency"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                <option value="SRD">SRD</option><option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={data.active} onChange={(e) => setData({ ...data, active: e.target.checked })} className="w-4 h-4 accent-[#FF5C00]" />
            Actief in dienst
          </label>
        </div>
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-3">
        <button onClick={onCancel} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
        <button onClick={save} disabled={loading || !data.name} data-testid="emp-save"
          className="flex-1 h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Opslaan
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}

// Inloggegevens: e-mail (hierboven) + wachtwoord + verplichte 4-cijferige PIN.
function LoginFields({ data, setData, isNew, hasLogin }) {
  const inputCls = 'w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none';
  return (
    <div className="rounded-2xl border-2 border-orange-100 bg-orange-50/40 p-3 sm:p-4 space-y-3" data-testid="emp-login-fields">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-[#FF5C00]" />
        <p className="text-sm font-black text-slate-900">Inloggen</p>
        {hasLogin && <span className="ml-auto text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Login actief</span>}
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        De werknemer logt één keer in met e-mail + wachtwoord. Daarna is op dat apparaat alleen de PIN nodig.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Wachtwoord</label>
          <input type="password" autoComplete="new-password" value={data.password}
            onChange={(e) => setData({ ...data, password: e.target.value })} data-testid="emp-password"
            placeholder={isNew || !hasLogin ? 'Min. 6 tekens' : 'Leeg = ongewijzigd'} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-slate-500">PIN (4 cijfers){isNew && ' *'}</label>
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={data.pin}
            onChange={(e) => setData({ ...data, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} data-testid="emp-pin"
            placeholder={isNew ? '• • • •' : 'Leeg = ongewijzigd'}
            className={`${inputCls} font-mono tracking-[0.4em] text-center`} />
        </div>
      </div>
    </div>
  );
}

function SalaryForm({ employees, onCancel, onSaved }) {
  const today = new Date();
  const [data, setData] = useState({
    employee_id: '', gross: 0, advance: 0, deductions: 0, currency: 'SRD',
    period_month: today.getMonth() + 1, period_year: today.getFullYear(), note: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-fill salary from employee record
  useEffect(() => {
    if (data.employee_id) {
      const e = employees.find((x) => x.id === data.employee_id);
      if (e && data.gross === 0) setData((d) => ({ ...d, gross: e.monthly_salary, currency: e.currency }));
    }
  }, [data.employee_id, data.gross, employees]);

  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);

  const net = (parseFloat(data.gross) || 0) - (parseFloat(data.advance) || 0) - (parseFloat(data.deductions) || 0);

  const save = async () => {
    setLoading(true); setError('');
    try {
      const { data: r } = await api.post('/salaries', {
        ...data,
        gross: parseFloat(data.gross) || 0,
        advance: parseFloat(data.advance) || 0,
        deductions: parseFloat(data.deductions) || 0,
        period_month: parseInt(data.period_month),
        period_year: parseInt(data.period_year),
      });
      onSaved(r);
    } catch (e) { setError(formatError(e)); }
    finally { setLoading(false); }
  };
  return (
    <KeyboardSafeModal onClose={onCancel} testId="salary-modal" maxWidthClass="sm:max-w-lg">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">Nieuwe loonstrook</h3>
          <button onClick={onCancel} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        {error && <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Werknemer *</label>
            <select value={data.employee_id} onChange={(e) => setData({ ...data, employee_id: e.target.value, gross: 0 })}
              data-testid="sal-employee" required
              className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
              <option value="">— Kies werknemer —</option>
              {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Maand</label>
              <select value={data.period_month} onChange={(e) => setData({ ...data, period_month: e.target.value })}
                data-testid="sal-month"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                {MONTHS_NL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Jaar</label>
              <input type="number" value={data.period_year} onChange={(e) => setData({ ...data, period_year: e.target.value })}
                data-testid="sal-year"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Bruto</label>
              <input type="number" step="0.01" value={data.gross} onChange={(e) => setData({ ...data, gross: e.target.value })}
                data-testid="sal-gross"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Voorschot</label>
              <input type="number" step="0.01" value={data.advance} onChange={(e) => setData({ ...data, advance: e.target.value })}
                data-testid="sal-advance"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Inhouding</label>
              <input type="number" step="0.01" value={data.deductions} onChange={(e) => setData({ ...data, deductions: e.target.value })}
                data-testid="sal-deductions"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
          </div>
          <div className="bg-gradient-to-r from-[#FFF4EC] to-[#FFE6D3] border border-[#FF5C00]/30 rounded-xl p-3 row-label-value items-center">
            <span className="text-xs font-bold uppercase tracking-widest text-[#C74600]">Netto uitbetaling</span>
            <span className="text-2xl font-black text-slate-900 tracking-tight">{fmtMoney(net, data.currency)}</span>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Notitie</label>
            <input value={data.note} onChange={(e) => setData({ ...data, note: e.target.value })} data-testid="sal-note"
              className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
          </div>
        </div>
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-3">
        <button onClick={onCancel} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
        <button onClick={save} disabled={loading || !data.employee_id} data-testid="sal-save"
          className="flex-1 h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Loonstrook opslaan
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}

export default function Employees() {
  // SWR + SSE live-sync — geen useEffect fetch, geen polling.
  const { data: empRaw, mutate: refetchEmp } = useApiSWR('/employees');
  const { data: salRaw, mutate: refetchSal } = useApiSWR('/salaries');
  const employees = empRaw || [];
  const salaries = salRaw || [];
  const [view, setView] = useState('employees'); // employees | salaries
  const [editing, setEditing] = useState(null);
  const [creatingEmp, setCreatingEmp] = useState(false);
  const [creatingSal, setCreatingSal] = useState(false);
  const [pinFor, setPinFor] = useState(null);

  const load = useCallback(async () => {
    await Promise.all([refetchEmp(), refetchSal()]);
  }, [refetchEmp, refetchSal]);

  const delEmp = async (id) => {
    if (!window.confirm('Werknemer verwijderen?')) return;
    await api.delete(`/employees/${id}`); load();
  };
  const delSal = async (id) => {
    if (!window.confirm('Loonstrook verwijderen?')) return;
    await api.delete(`/salaries/${id}`); load();
  };
  const apiBase = `${process.env.REACT_APP_BACKEND_URL}/api`;

  return (
    <div>
      <PageHeader title="Werknemers" subtitle={`${employees.filter((e) => e.active).length} actief, ${salaries.length} loonstroken`}
        action={
          view === 'employees' ? (
            <button onClick={() => setCreatingEmp(true)} data-testid="emp-new-btn"
              className="w-full sm:w-auto justify-center inline-flex items-center gap-2 px-5 py-3 bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold rounded-xl shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)]">
              <Plus className="w-4 h-4" /> Nieuwe werknemer
            </button>
          ) : (
            <button onClick={() => setCreatingSal(true)} data-testid="sal-new-btn"
              className="w-full sm:w-auto justify-center inline-flex items-center gap-2 px-5 py-3 bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold rounded-xl shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)]">
              <Plus className="w-4 h-4" /> Nieuwe loonstrook
            </button>
          )
        }
      />
      <div className="flex gap-2 mb-4">
        <button onClick={() => setView('employees')} data-testid="view-employees"
          className={`px-4 py-2 rounded-xl font-bold text-sm ${view === 'employees' ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          <UsersIcon className="w-4 h-4 inline mr-1.5" /> Personeel
        </button>
        <button onClick={() => setView('salaries')} data-testid="view-salaries"
          className={`px-4 py-2 rounded-xl font-bold text-sm ${view === 'salaries' ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          <Receipt className="w-4 h-4 inline mr-1.5" /> Loonstroken
        </button>
      </div>

      {view === 'employees' ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_-2px_rgba(15,23,42,0.06)] overflow-hidden">
          {employees.length === 0 ? (
            <div className="p-10 text-center"><UsersIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-semibold">Geen werknemers.</p></div>
          ) : (
            <>
            <div className="md:hidden divide-y divide-slate-100" data-testid="emp-cards">
              {employees.map((e) => (
                <div key={e.id} data-testid={`emp-card-${e.id}`} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">{e.name}</p>
                      {e.role && <p className="text-[11px] text-slate-400 truncate">{e.role}</p>}
                    </div>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-bold ${e.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {e.active ? 'Actief' : 'Inactief'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <RoleBadge appRole={e.app_role} hasKioskPin={e.has_kiosk_pin} />
                    {e.has_login && <span className="text-[10px] uppercase tracking-wider font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Login</span>}
                  </div>
                  {(e.email || e.phone) && <p className="mt-2 text-xs text-slate-500 break-all">{[e.phone, e.email].filter(Boolean).join(' · ')}</p>}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="font-black text-slate-900">{fmtMoney(e.monthly_salary, e.currency)}</p>
                    <EmpActions e={e} load={load} onPin={setPinFor} onEdit={setEditing} onDelete={delEmp} />
                  </div>
                </div>
              ))}
            </div>
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-slate-50/70 text-left">
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th className="px-5 py-3">Naam</th>
                  <th className="px-5 py-3">Rol</th>
                  <th className="px-5 py-3 hidden md:table-cell">Contact</th>
                  <th className="px-5 py-3 text-right">Salaris</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Acties</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} data-testid={`emp-row-${e.id}`} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-bold text-slate-900">
                      {e.name}
                      {e.role && <span className="block text-[11px] font-normal text-slate-400 mt-0.5">{e.role}</span>}
                    </td>
                    <td className="px-5 py-3">
                      <RoleBadge appRole={e.app_role} hasKioskPin={e.has_kiosk_pin} />
                      {e.has_login && <span className="mt-1 inline-block text-[10px] uppercase tracking-wider font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Login</span>}
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell text-slate-500 text-xs">
                      <p>{e.phone || '—'}</p><p>{e.email}</p>
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-slate-900">{fmtMoney(e.monthly_salary, e.currency)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${e.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {e.active ? 'Actief' : 'Inactief'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <EmpActions e={e} load={load} onPin={setPinFor} onEdit={setEditing} onDelete={delEmp} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_-2px_rgba(15,23,42,0.06)] overflow-hidden">
          {salaries.length === 0 ? (
            <div className="p-10 text-center"><Receipt className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-semibold">Geen loonstroken.</p></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-orange-50/50 text-left">
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <th className="px-3 sm:px-5 py-3">Werknemer</th>
                  <th className="px-5 py-3">Periode</th>
                  <th className="px-5 py-3 text-right hidden md:table-cell">Bruto</th>
                  <th className="px-5 py-3 text-right hidden md:table-cell">Aftrek</th>
                  <th className="px-5 py-3 text-right">Netto</th>
                  <th className="px-5 py-3 text-right">Acties</th>
                </tr>
              </thead>
              <tbody>
                {salaries.map((s) => (
                  <tr key={s.id} data-testid={`sal-row-${s.id}`} className="border-t border-orange-50 hover:bg-orange-50/30">
                    <td className="px-5 py-3 font-bold text-slate-900">{s.employee_name}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs capitalize">{MONTHS_NL[s.period_month - 1]} {s.period_year}</td>
                    <td className="px-5 py-3 text-right hidden md:table-cell text-slate-700">{fmtMoney(s.gross, s.currency)}</td>
                    <td className="px-5 py-3 text-right hidden md:table-cell text-slate-500">{fmtMoney(s.advance + s.deductions, s.currency)}</td>
                    <td className="px-5 py-3 text-right font-black text-slate-900">{fmtMoney(s.net, s.currency)}</td>
                    <td className="px-5 py-3 text-right space-x-1">
                      <a href={`${apiBase}/salaries/${s.id}/pdf`} target="_blank" rel="noreferrer"
                        data-testid={`sal-pdf-${s.id}`}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600" title="PDF">
                        <FileText className="w-3.5 h-3.5" />
                      </a>
                      <button onClick={() => delSal(s.id)} data-testid={`sal-delete-${s.id}`}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(editing || creatingEmp) && <EmployeeForm initial={editing}
        onCancel={() => { setEditing(null); setCreatingEmp(false); }}
        onSaved={() => { setEditing(null); setCreatingEmp(false); load(); }} />}
      {creatingSal && <SalaryForm employees={employees}
        onCancel={() => setCreatingSal(false)}
        onSaved={() => { setCreatingSal(false); load(); }} />}
      {pinFor && <KioskPinModal employee={pinFor}
        onCancel={() => setPinFor(null)}
        onSaved={() => { setPinFor(null); load(); }} />}
    </div>
  );
}

// =====================================================================
// RoleBadge — visuele indicator van de systeemrol
// =====================================================================
function RoleBadge({ appRole, hasKioskPin }) {
  if (!appRole) {
    return <span className="text-xs text-slate-400 italic">Niet ingesteld</span>;
  }
  const variants = {
    admin:      { label: 'Beheerder',   cls: 'bg-orange-50 text-[#C74600] border-orange-200' },
    boekhouder: { label: 'Boekhouder',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    kiosk:      { label: 'Kiosk',       cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  };
  const v = variants[appRole] || variants.admin;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block text-[10px] uppercase tracking-wider font-black px-2 py-0.5 rounded-full border ${v.cls}`}>
        {v.label}
      </span>
      {!hasKioskPin && (
        <span className="text-[10px] text-amber-600 font-bold" title="Stel een PIN in zodat deze werknemer kan inloggen">
          ⚠ PIN
        </span>
      )}
    </div>
  );
}

// =====================================================================
// KioskPinModal — stel/wijzig PIN voor kiosk-medewerker
// =====================================================================
function KioskPinModal({ employee, onCancel, onSaved }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (!/^\d{4}$/.test(pin)) { setErr('PIN moet uit precies 4 cijfers bestaan'); return; }
    if (pin !== pin2) { setErr('PIN herhalen klopt niet'); return; }
    setSaving(true);
    try {
      await api.post(`/employees/${employee.id}/kiosk-pin`, { pin });
      onSaved();
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };
  return (
    <KeyboardSafeModal onClose={onCancel} testId="kiosk-pin-modal" maxWidthClass="sm:max-w-sm">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-amber-700" />
            </div>
            <h3 className="text-lg font-black text-slate-900">PIN instellen</h3>
          </div>
          <button onClick={onCancel} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-slate-500 mt-2">
          PIN voor <span className="font-bold text-slate-900">{employee.name}</span> om snel in te loggen op een vertrouwd apparaat{employee.app_role === 'kiosk' ? ' en betalingen op de kiosk te registreren' : ''}.
        </p>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Nieuwe PIN (4 cijfers)</label>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              data-testid="kiosk-pin-input" type="password" inputMode="numeric" maxLength={4}
              className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-amber-500 outline-none font-mono text-lg tracking-widest text-center" />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Herhaal PIN</label>
            <input value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 4))}
              data-testid="kiosk-pin-input-2" type="password" inputMode="numeric" maxLength={4}
              className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-amber-500 outline-none font-mono text-lg tracking-widest text-center" />
          </div>
        </div>
        {err && <div className="mt-3 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{err}</div>}
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-2">
        <button onClick={onCancel} className="px-4 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm">Annuleer</button>
        <button onClick={submit} disabled={saving} data-testid="kiosk-pin-save"
          className="flex-1 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ShieldCheck className="w-4 h-4" /> PIN opslaan</>}
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}
