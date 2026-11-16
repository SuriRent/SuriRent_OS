import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote, CheckCircle2, FileText, Loader2, Search,
  ShieldCheck, Upload, UserRound,
} from 'lucide-react';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../../lib/api';

const CURRENCIES = ['SRD', 'USD', 'EUR'];
const CATEGORIES = [
  ['huur', 'Huur'],
  ['servicekosten', 'Servicekosten'],
  ['borg', 'Borg'],
  ['boete', 'Boete'],
  ['internet', 'Internet'],
  ['overig', 'Overig'],
  ['vooruitbetaling', 'Vooruitbetaling'],
];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
const DESCRIPTION_LABEL = /^(omschrijving|description|mededeling|betalingskenmerk|payment details|remarks?)\b/i;
const NEXT_FIELD_LABEL = /^(bedrag|amount|datum|date|van|from|naar|to|rekening|account|referentie|reference|status|valuta|currency)\b/i;

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeName(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function datePeriod(value) {
  const [year, month] = String(value || '').split('-').map(Number);
  return year && month >= 1 && month <= 12
    ? { period_year: year, period_month: month }
    : {};
}

function createPaymentForm() {
  const now = new Date();
  return {
    tenant_id: '',
    tenant_search: '',
    amount: '',
    currency: 'SRD',
    category: 'huur',
    paid_date: todayIso(),
    period_month: now.getMonth() + 1,
    period_year: now.getFullYear(),
    bank_payer_name: '',
    bank_reference: '',
    note: '',
  };
}

function extractDescription(ocrText) {
  const lines = String(ocrText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labelIndex = lines.findIndex((line) => DESCRIPTION_LABEL.test(line));
  if (labelIndex < 0) return '';

  const inlineDescription = lines[labelIndex].replace(DESCRIPTION_LABEL, '').replace(/^[:\s-]+/, '').trim();
  if (inlineDescription) return inlineDescription.slice(0, 240);
  const nextLine = lines[labelIndex + 1] || '';
  return NEXT_FIELD_LABEL.test(nextLine) ? '' : nextLine.slice(0, 240);
}

function matchTenant(description, tenants) {
  const normalizedDescription = normalizeName(description);
  if (!normalizedDescription) return { tenantId: '', status: 'no-description' };

  const matches = tenants.flatMap((tenant) => {
    const name = normalizeName(tenant.name);
    const apartment = normalizeName(tenant.apartment_number);
    const nameMatch = name.length >= 4 && ` ${normalizedDescription} `.includes(` ${name} `);
    const apartmentMatch = apartment.length >= 2 && ` ${normalizedDescription} `.includes(` ${apartment} `);
    if (!nameMatch && !apartmentMatch) return [];
    return [{ tenantId: tenant.id, score: nameMatch ? 2 : 1 }];
  });
  if (!matches.length) return { tenantId: '', status: 'unmatched' };

  const bestScore = Math.max(...matches.map((match) => match.score));
  const bestMatches = [...new Set(matches.filter((match) => match.score === bestScore).map((match) => match.tenantId))];
  return bestMatches.length === 1
    ? { tenantId: bestMatches[0], status: 'matched' }
    : { tenantId: '', status: 'ambiguous' };
}

async function renderPdfPages(file, worker) {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableWorker: true,
    isEvalSupported: false,
  }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1800 / baseViewport.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pages.push((await worker.recognize(canvas)).data.text);
  }
  return pages.join('\n');
}

function BankReconciliation({ kioskLayout = false }) {
  const [tenants, setTenants] = useState([]);
  const [tenantsError, setTenantsError] = useState('');
  const [rows, setRows] = useState([]);
  const [uploadError, setUploadError] = useState('');
  const [processing, setProcessing] = useState(false);
  const previewUrls = useRef(new Set());

  useEffect(() => {
    let active = true;
    api.get('/tenants')
      .then(({ data }) => { if (active) setTenants(Array.isArray(data) ? data : []); })
      .catch((error) => { if (active) setTenantsError(formatError(error)); });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!tenants.length) return;
    setRows((current) => {
      let changed = false;
      const next = current.map((row) => {
        if (!row.ocrText || row.matchChecked || row.form.tenant_id) return row;
        const result = matchTenant(row.description, tenants);
        changed = true;
        return {
          ...row,
          matchChecked: true,
          matchStatus: result.status,
          form: { ...row.form, tenant_id: result.tenantId },
        };
      });
      return changed ? next : current;
    });
  }, [tenants, rows]);

  const sortedTenants = useMemo(() => [...tenants].sort((a, b) => (
    String(a.apartment_number || '').localeCompare(
      String(b.apartment_number || ''), undefined, { numeric: true },
    )
  )), [tenants]);

  const updateRow = (id, patch) => setRows((current) => current.map((row) => (
    row.id === id ? { ...row, ...patch } : row
  )));
  const updateForm = (id, key, value) => setRows((current) => current.map((row) => (
    row.id === id ? { ...row, form: { ...row.form, [key]: value } } : row
  )));

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setUploadError('');

    const accepted = [];
    const rejected = [];
    files.forEach((file) => {
      const extension = file.name.toLowerCase().split('.').pop();
      const typeAllowed = ALLOWED_TYPES.includes(file.type)
        || (!file.type && ['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(extension));
      if (!typeAllowed) rejected.push(`${file.name}: niet-ondersteund bestandstype`);
      else if (file.size > MAX_FILE_BYTES) rejected.push(`${file.name}: groter dan 5 MB`);
      else accepted.push(file);
    });
    if (rejected.length) setUploadError(rejected.join('. '));
    if (!accepted.length) return;

    const newRows = accepted.map((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return {
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl,
        isImage: file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name),
        status: 'queued',
        statement: null,
        ocrText: '',
        description: '',
        matchChecked: false,
        matchStatus: '',
        saveError: '',
        saving: false,
        registeredPayment: null,
        form: createPaymentForm(),
      };
    });
    setRows((current) => [...current, ...newRows]);
    setProcessing(true);

    let worker = null;
    let workerError = '';
    try {
      worker = await createWorker('nld+eng');
    } catch (error) {
      workerError = `OCR kon niet worden gestart: ${formatError(error)}`;
    }

    for (const row of newRows) {
      updateRow(row.id, { status: 'uploading' });
      let statement;
      try {
        const payload = new FormData();
        payload.append('file', row.file);
        ({ data: statement } = await api.post('/bank-reconciliation/uploads', payload));
      } catch (error) {
        updateRow(row.id, {
          status: 'error',
          uploadError: `Upload niet gelukt: ${formatError(error)}`,
        });
        continue;
      }
      updateRow(row.id, { statement });
      if (!worker) {
        updateRow(row.id, { status: 'ready', ocrError: workerError });
        continue;
      }
      try {
        updateRow(row.id, { status: 'reading' });
        const ocrText = row.isImage
          ? (await worker.recognize(row.file)).data.text
          : await renderPdfPages(row.file, worker);
        const description = extractDescription(ocrText);
        const result = matchTenant(description, tenants);
        setRows((current) => current.map((item) => item.id === row.id ? {
          ...item,
          status: 'ready',
          ocrText,
          description,
          matchChecked: tenants.length > 0,
          matchStatus: item.form.tenant_id ? 'manual' : (tenants.length ? result.status : ''),
          form: {
            ...item.form,
            tenant_id: item.form.tenant_id || (tenants.length ? result.tenantId : ''),
          },
        } : item));
      } catch (error) {
        updateRow(row.id, {
          status: 'ready',
          ocrError: `OCR niet gelukt: ${formatError(error)}`,
        });
      }
    }
    if (worker) await worker.terminate();
    setProcessing(false);
  };

  const registerPayment = async (event, row) => {
    event.preventDefault();
    if (!row.statement || !row.form.tenant_id || Number(row.form.amount) <= 0) return;
    updateRow(row.id, { saving: true, saveError: '' });
    try {
      const isPeriodPayment = ['huur', 'vooruitbetaling'].includes(row.form.category);
      const { data } = await api.post(`/bank-reconciliation/${row.statement.id}/register`, {
        tenant_id: row.form.tenant_id,
        amount: Number(row.form.amount),
        currency: row.form.currency,
        category: row.form.category,
        paid_date: row.form.paid_date,
        period_month: isPeriodPayment ? Number(row.form.period_month) : null,
        period_year: isPeriodPayment ? Number(row.form.period_year) : null,
        bank_payer_name: row.form.bank_payer_name,
        bank_reference: row.form.bank_reference,
        note: row.form.note,
      });
      updateRow(row.id, { saving: false, registeredPayment: data });
      window.dispatchEvent(new CustomEvent('surirent:live-change'));
    } catch (error) {
      updateRow(row.id, { saving: false, saveError: formatError(error) });
    }
  };

  const containerClass = kioskLayout ? 'h-full overflow-y-auto px-4 py-5 sm:px-6' : '';

  return (
    <div className={containerClass} data-testid="bank-reconciliation-page">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-[#FF5C00]">
              <Banknote className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 sm:text-2xl">Bankreconciliatie</h1>
              <p className="text-sm font-medium text-slate-500">Upload meerdere betaalbewijzen en controleer de OCR-match per betaling.</p>
            </div>
          </div>
        </header>

        <div className="flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <p><strong>Controleer elk bewijs.</strong> OCR leest de omschrijving lokaal uit en selecteert alleen bij een eenduidige match automatisch een huurder. Er wordt niets geboekt totdat u per bewijs op “Betaling registreren” klikt.</p>
        </div>

        <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div>
            <h2 className="text-base font-black text-slate-900">Betaalbewijzen uploaden</h2>
            <p className="mt-1 text-sm text-slate-500">Selecteer meerdere PDF-, JPG-, PNG- of WEBP-bestanden · maximaal 5 MB per bestand.</p>
          </div>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/60 px-4 py-5 text-center hover:border-[#FF5C00] hover:bg-orange-50">
            {processing ? <Loader2 className="h-7 w-7 animate-spin text-[#FF5C00]" /> : <Upload className="h-7 w-7 text-[#FF5C00]" />}
            <span className="font-bold text-slate-800">{processing ? 'Bewijzen uploaden en OCR uitvoeren…' : 'Kies één of meerdere betaalbewijzen'}</span>
            <input type="file" multiple accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp" className="sr-only"
              onChange={handleUpload} disabled={processing} data-testid="bank-reconciliation-file" />
          </label>
          {uploadError && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{uploadError}</p>}
          {tenantsError && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{tenantsError}</p>}
        </section>

        {rows.map((row, index) => {
          const selectedTenant = tenants.find((tenant) => tenant.id === row.form.tenant_id);
          const isPeriodPayment = ['huur', 'vooruitbetaling'].includes(row.form.category);
          const query = normalizeName(row.form.tenant_search);
          const visibleTenants = sortedTenants.filter((tenant) => (
            !query || normalizeName(`${tenant.name} ${tenant.apartment_number || ''} ${tenant.phone || ''}`).includes(query)
          ));
          const isBusy = ['queued', 'uploading', 'reading'].includes(row.status);

          return (
            <section key={row.id} className="grid gap-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(420px,1.2fr)]">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-black text-slate-900">Bewijs {index + 1}</h2>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                    row.registeredPayment ? 'bg-emerald-100 text-emerald-800'
                      : isBusy ? 'bg-blue-100 text-blue-800'
                        : row.uploadError ? 'bg-red-100 text-red-800'
                          : row.ocrError ? 'bg-amber-100 text-amber-900'
                          : 'bg-slate-100 text-slate-700'
                  }`}>
                    {row.registeredPayment ? 'Geregistreerd'
                      : row.status === 'queued' ? 'Wachtrij'
                        : row.status === 'uploading' ? 'Uploaden'
                          : row.status === 'reading' ? 'OCR bezig'
                            : row.status === 'error' ? 'Upload mislukt'
                            : row.ocrError ? 'OCR controleren'
                              : 'Klaar voor controle'}
                  </span>
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
                    <FileText className="h-4 w-4 shrink-0 text-[#FF5C00]" />
                    <span className="truncate">{row.file.name}</span>
                  </div>
                  {row.isImage && <img src={row.previewUrl} alt={`Voorbeeld ${row.file.name}`} className="max-h-72 w-full object-contain p-2" />}
                  {!row.isImage && <iframe title={`Voorbeeld ${row.file.name}`} src={row.previewUrl} className="h-72 w-full" />}
                </div>
                {row.uploadError && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{row.uploadError}</p>}
                {row.ocrError && <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="status">{row.ocrError}. U kunt de gegevens nog handmatig invullen.</p>}
                {row.description && (
                  <div className={`rounded-xl border p-3 text-sm ${
                    row.matchStatus === 'matched' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}>
                    <strong>Omschrijving uit OCR:</strong>
                    <p className="mt-1 break-words">{row.description}</p>
                    {row.matchStatus === 'matched' && selectedTenant && <p className="mt-2 font-bold">Huurder automatisch geselecteerd: {selectedTenant.name}</p>}
                    {row.matchStatus === 'manual' && <p className="mt-2 font-bold">Huurder handmatig gekozen.</p>}
                    {row.matchStatus === 'ambiguous' && <p className="mt-2 font-bold">Meerdere huurders komen overeen. Kies de juiste huurder handmatig.</p>}
                    {row.matchStatus === 'unmatched' && <p className="mt-2 font-bold">Geen eenduidige huurder gevonden. Kies de juiste huurder handmatig.</p>}
                    {row.matchStatus === 'no-description' && <p className="mt-2 font-bold">Geen omschrijving gevonden. Kies de huurder handmatig.</p>}
                  </div>
                )}
                {row.status === 'ready' && !row.description && !row.ocrError && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Geen omschrijving gevonden. De huurder is niet automatisch geselecteerd; kies deze handmatig.</p>
                )}
                {row.ocrText && (
                  <details className="rounded-xl border border-slate-200 p-3 text-sm">
                    <summary className="cursor-pointer font-bold text-slate-700">Volledige OCR-tekst bekijken</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-600">{row.ocrText}</pre>
                  </details>
                )}
              </div>

              {row.registeredPayment ? (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" data-testid="bank-reconciliation-success">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                  <div>
                    <h3 className="text-lg font-black text-emerald-900">Betaling geregistreerd</h3>
                    <p className="mt-1 text-sm font-semibold text-emerald-800">
                      {row.registeredPayment.tenant_name || selectedTenant?.name} · {fmtMoney(row.registeredPayment.amount, row.registeredPayment.currency)}
                      {row.registeredPayment.receipt_number ? ` · bon ${row.registeredPayment.receipt_number}` : ''}
                    </p>
                    <p className="mt-2 text-xs font-medium text-emerald-700">Het bewijs is aan de betaling gekoppeld en de factuurverwerking is bijgewerkt.</p>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="text-base font-black text-slate-900">Gegevens controleren en registreren</h3>
                  <p className="mb-4 mt-1 text-sm text-slate-500">Controleer de OCR-selectie en vul het bedrag en de betaaldatum in.</p>
                  {row.saveError && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{row.saveError}</p>}
                  <form className="space-y-3" onSubmit={(event) => registerPayment(event, row)}>
                    <div>
                      <label htmlFor={`bank-tenant-search-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Huurder *</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                        <input id={`bank-tenant-search-${row.id}`} value={row.form.tenant_search}
                          onChange={(event) => updateForm(row.id, 'tenant_search', event.target.value)}
                          placeholder="Zoek naam, appartement of telefoon"
                          className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 outline-none focus:border-[#FF5C00]" />
                      </div>
                      <select value={row.form.tenant_id} onChange={(event) => updateForm(row.id, 'tenant_id', event.target.value)}
                        required disabled={tenants.length === 0} data-testid="bank-reconciliation-tenant"
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#FF5C00]">
                        <option value="">— Kies huurder —</option>
                        {visibleTenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.apartment_number ? `${tenant.apartment_number} · ` : ''}{tenant.name}
                          </option>
                        ))}
                      </select>
                      {selectedTenant && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-700"><UserRound className="h-3.5 w-3.5" /> Geselecteerd: {selectedTenant.name}</p>}
                    </div>

                    <div className="grid grid-cols-[1fr_110px] gap-3">
                      <div>
                        <label htmlFor={`bank-amount-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Bedrag *</label>
                        <input id={`bank-amount-${row.id}`} type="number" min="0.01" step="0.01" value={row.form.amount}
                          onChange={(event) => updateForm(row.id, 'amount', event.target.value)} required data-testid="bank-reconciliation-amount"
                          className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-[#FF5C00]" />
                      </div>
                      <div>
                        <label htmlFor={`bank-currency-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Valuta</label>
                        <select id={`bank-currency-${row.id}`} value={row.form.currency} onChange={(event) => updateForm(row.id, 'currency', event.target.value)}
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-[#FF5C00]">
                          {CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`bank-date-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Betaaldatum *</label>
                        <input id={`bank-date-${row.id}`} type="date" value={row.form.paid_date}
                          onChange={(event) => {
                            const value = event.target.value;
                            setRows((current) => current.map((item) => item.id === row.id ? {
                              ...item, form: { ...item.form, paid_date: value, ...datePeriod(value) },
                            } : item));
                          }} required className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-[#FF5C00]" />
                      </div>
                      <div>
                        <label htmlFor={`bank-category-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Categorie</label>
                        <select id={`bank-category-${row.id}`} value={row.form.category} onChange={(event) => updateForm(row.id, 'category', event.target.value)}
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-[#FF5C00]">
                          {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </div>
                    </div>

                    {isPeriodPayment && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor={`bank-month-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Huurperiode</label>
                          <select id={`bank-month-${row.id}`} value={row.form.period_month} onChange={(event) => updateForm(row.id, 'period_month', event.target.value)}
                            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-[#FF5C00]">
                            {MONTHS_NL.map((month, monthIndex) => <option key={month} value={monthIndex + 1}>{month}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`bank-year-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Jaar</label>
                          <input id={`bank-year-${row.id}`} type="number" min="2000" max="2100" value={row.form.period_year}
                            onChange={(event) => updateForm(row.id, 'period_year', event.target.value)}
                            className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-[#FF5C00]" />
                        </div>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`bank-payer-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Naam op bewijs</label>
                        <input id={`bank-payer-${row.id}`} value={row.form.bank_payer_name}
                          onChange={(event) => updateForm(row.id, 'bank_payer_name', event.target.value)}
                          className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-[#FF5C00]" />
                      </div>
                      <div>
                        <label htmlFor={`bank-reference-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Bankreferentie</label>
                        <input id={`bank-reference-${row.id}`} value={row.form.bank_reference}
                          onChange={(event) => updateForm(row.id, 'bank_reference', event.target.value)}
                          className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-[#FF5C00]" />
                      </div>
                    </div>

                    <div>
                      <label htmlFor={`bank-note-${row.id}`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Notitie</label>
                      <textarea id={`bank-note-${row.id}`} rows="2" value={row.form.note}
                        onChange={(event) => updateForm(row.id, 'note', event.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-[#FF5C00]" />
                    </div>

                    <button type="submit" disabled={!row.statement || !row.form.tenant_id || Number(row.form.amount) <= 0 || !row.form.paid_date || row.saving || isBusy}
                      data-testid="bank-reconciliation-register"
                      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-4 py-3 font-black text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300">
                      {row.saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                      {row.saving ? 'Betaling registreren…' : 'Betaling registreren'}
                    </button>
                    {!row.statement && <p className="text-center text-xs font-medium text-slate-400">Bewijs wordt eerst veilig opgeslagen.</p>}
                  </form>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default BankReconciliation;
