import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote, CheckCircle2, Loader2, Search, Upload,
} from 'lucide-react';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../../lib/api';
import { parseBankStatementFile } from '../../../lib/bankStatementImport';

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
const STRUCTURED_EXTENSIONS = ['csv', 'ofx', 'mt940', 'sta', '940', 'txt'];
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

function getRowStatus(row) {
  if (row.registeredPayment) return { label: 'Geregistreerd', style: 'bg-emerald-100 text-emerald-800' };
  if (row.uploadError) return { label: 'Upload mislukt', style: 'bg-red-100 text-red-800' };
  if (row.status === 'queued') return { label: 'Wachtrij', style: 'bg-slate-100 text-slate-700' };
  if (row.status === 'uploading') return { label: 'Uploaden', style: 'bg-blue-100 text-blue-800' };
  if (row.status === 'reading') return { label: 'OCR bezig', style: 'bg-blue-100 text-blue-800' };
  if (row.ocrError) return { label: 'OCR controleren', style: 'bg-amber-100 text-amber-900' };
  if (row.matchStatus === 'matched' && row.form.tenant_id) {
    return { label: 'Huurder gevonden', style: 'bg-emerald-100 text-emerald-800' };
  }
  return { label: 'Controle nodig', style: 'bg-amber-100 text-amber-900' };
}

function getFileExtension(file) {
  return String(file.name || '').toLowerCase().split('.').pop();
}

function isStructuredStatement(file) {
  return STRUCTURED_EXTENSIONS.includes(getFileExtension(file));
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

function BankReconciliation({ kioskLayout = false, embedded = false }) {
  const [tenants, setTenants] = useState([]);
  const [tenantsError, setTenantsError] = useState('');
  const [rows, setRows] = useState([]);
  const [activeRowId, setActiveRowId] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [importNotice, setImportNotice] = useState('');
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
        if (!(row.matchText || row.ocrText) || row.matchChecked || row.form.tenant_id) return row;
        const result = matchTenant(row.matchText || row.description, tenants);
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
    setImportNotice('');

    const accepted = [];
    const rejected = [];
    files.forEach((file) => {
      const extension = getFileExtension(file);
      const typeAllowed = ALLOWED_TYPES.includes(file.type)
        || STRUCTURED_EXTENSIONS.includes(extension)
        || ['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(extension);
      if (!typeAllowed) rejected.push(`${file.name}: niet-ondersteund bestandstype`);
      else if (file.size > MAX_FILE_BYTES) rejected.push(`${file.name}: groter dan 5 MB`);
      else accepted.push(file);
    });
    const parsedStatements = new Map();
    const importWarnings = [];
    for (const file of accepted.filter(isStructuredStatement)) {
      try {
        const parsed = await parseBankStatementFile(file);
        if (parsed.transactions.length > 1000) {
          throw new Error('Meer dan 1.000 transacties in één bestand; splits het afschrift op.');
        }
        parsedStatements.set(file, parsed);
        if (parsed.skippedCount) {
          importWarnings.push(`${file.name}: ${parsed.skippedCount} uitgaande transacties overgeslagen.`);
        }
      } catch (error) {
        rejected.push(`${file.name}: ${formatError(error)}`);
      }
    }

    const validFiles = accepted.filter((file) => (
      !isStructuredStatement(file) || parsedStatements.has(file)
    ));
    if (rejected.length) setUploadError(rejected.join('. '));
    if (importWarnings.length) setImportNotice(importWarnings.join(' '));
    if (!validFiles.length) return;

    const proofFiles = validFiles.filter((file) => !isStructuredStatement(file));
    const proofRows = proofFiles.map((file, index) => {
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
    const proofRowsByFile = new Map(proofFiles.map((file, index) => [file, proofRows[index]]));
    let firstNewRowId = proofRows[0]?.id || '';
    if (proofRows.length) {
      setRows((current) => [...current, ...proofRows]);
      setActiveRowId(proofRows[0].id);
    }
    setProcessing(true);

    let worker = null;
    let workerError = '';
    if (proofFiles.length) {
      try {
        worker = await createWorker('nld+eng');
      } catch (error) {
        workerError = `OCR kon niet worden gestart: ${formatError(error)}`;
      }
    }

    try {
      for (const file of validFiles) {
        if (isStructuredStatement(file)) {
          try {
            const payload = new FormData();
            payload.append('file', file);
            const { data: statement } = await api.post('/bank-reconciliation/uploads', payload);
            const { data } = await api.post(
              `/bank-reconciliation/${statement.id}/transactions`,
              { transactions: parsedStatements.get(file).transactions },
            );
            if (!data.transactions?.length) throw new Error('Geen transacties geïmporteerd.');
            const previewUrl = URL.createObjectURL(file);
            previewUrls.current.add(previewUrl);
            const importedRows = (data.transactions || []).map((item, index) => {
              const transaction = item.transaction || {};
              const matchText = [transaction.description, transaction.payer_name].filter(Boolean).join(' ');
              const result = matchTenant(matchText, tenants);
              const date = transaction.date || todayIso();
              const displayName = transaction.description
                || `${date} · ${fmtMoney(transaction.amount, transaction.currency || 'SRD')}`;
              return {
                id: item.id,
                file,
                displayName: `${file.name} · ${index + 1}: ${displayName}`,
                previewUrl,
                isImage: false,
                isStructured: true,
                status: 'ready',
                statement: item,
                ocrText: transaction.description || '',
                description: transaction.description || '',
                matchText,
                matchChecked: tenants.length > 0,
                matchStatus: tenants.length ? result.status : '',
                saveError: '',
                saving: false,
                registeredPayment: null,
                form: {
                  ...createPaymentForm(),
                  tenant_id: tenants.length ? result.tenantId : '',
                  amount: String(transaction.amount || ''),
                  currency: transaction.currency || 'SRD',
                  paid_date: date,
                  ...datePeriod(date),
                  bank_payer_name: transaction.payer_name || '',
                  bank_reference: transaction.reference || '',
                },
              };
            });
            if (importedRows.length) {
              setRows((current) => [...current, ...importedRows]);
              if (!firstNewRowId) firstNewRowId = importedRows[0].id;
            }
          } catch (error) {
            setUploadError((current) => [
              current,
              `${file.name}: importeren mislukt: ${formatError(error)}`,
            ].filter(Boolean).join('. '));
          }
          continue;
        }

        const row = proofRowsByFile.get(file);
        if (!firstNewRowId) firstNewRowId = row.id;
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
    } finally {
      if (worker) await worker.terminate();
      if (firstNewRowId) setActiveRowId(firstNewRowId);
      setProcessing(false);
    }
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
  const activeRow = rows.find((row) => row.id === activeRowId) || rows[0] || null;
  const activeIndex = activeRow ? rows.findIndex((row) => row.id === activeRow.id) : -1;
  const selectedTenant = activeRow && tenants.find((tenant) => tenant.id === activeRow.form.tenant_id);
  const tenantQuery = normalizeName(activeRow?.form.tenant_search);
  const visibleTenants = sortedTenants.filter((tenant) => (
    !tenantQuery || normalizeName(`${tenant.name} ${tenant.apartment_number || ''} ${tenant.phone || ''}`).includes(tenantQuery)
  ));
  const isPeriodPayment = activeRow && ['huur', 'vooruitbetaling'].includes(activeRow.form.category);
  const isActiveBusy = activeRow && ['queued', 'uploading', 'reading'].includes(activeRow.status);

  return (
    <div className={containerClass} data-testid="bank-reconciliation-page">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        {!embedded && (
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-[#FF5C00]">
                <Banknote className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 sm:text-2xl">Bankreconciliatie</h1>
                <p className="text-sm font-medium text-slate-500">Importeer MT940, OFX of CSV; gebruik PDF of afbeelding voor OCR.</p>
              </div>
            </div>
          </header>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-900">Betalingen controleren</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {rows.length ? `${rows.length} transactie${rows.length === 1 ? '' : 's'} in deze batch` : 'Importeer een afschrift of upload losse betaalbewijzen.'}
            </p>
          </div>
          <label className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-4 py-2 text-sm font-bold text-white transition hover:bg-orange-600 ${processing ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}>
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {processing ? 'Verwerken…' : 'Afschrift toevoegen'}
            <input type="file" multiple
              accept=".mt940,.sta,.940,.ofx,.csv,.txt,.pdf,.jpg,.jpeg,.png,.webp,text/csv,application/x-ofx,application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={handleUpload} disabled={processing} data-testid="bank-reconciliation-file" />
          </label>
        </div>

        {uploadError && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{uploadError}</p>}
        {importNotice && <p className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900" role="status">{importNotice}</p>}
        {tenantsError && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{tenantsError}</p>}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
            <Upload className="mx-auto h-8 w-8 text-[#FF5C00]" />
            <p className="mt-3 font-bold text-slate-800">Nog geen afschrift</p>
            <p className="mt-1 text-sm text-slate-500">Importeer MT940, OFX of CSV, of upload een PDF/afbeelding voor OCR.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.length > 1 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <label htmlFor="bank-reconciliation-active-proof" className="shrink-0 text-xs font-bold text-slate-600">
                  Transactie {activeIndex + 1} van {rows.length}
                </label>
                <select id="bank-reconciliation-active-proof" value={activeRow?.id || ''}
                  onChange={(event) => setActiveRowId(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-[#FF5C00] focus:outline-none">
                  {rows.map((row) => <option key={row.id} value={row.id}>{row.displayName || row.file.name} · {getRowStatus(row).label}</option>)}
                </select>
              </div>
            )}

            {activeRow && (
              <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      {activeRow.registeredPayment ? 'Afgerond' : 'Controle en registratie'}
                    </p>
                    <h3 className="mt-1 truncate text-base font-black text-slate-900">
                      {rows.length === 1 ? (activeRow.displayName || activeRow.file.name) : 'Betaling controleren'}
                    </h3>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${getRowStatus(activeRow).style}`}>
                    {getRowStatus(activeRow).label}
                  </span>
                </div>

                {activeRow.uploadError && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{activeRow.uploadError}</p>}
                {activeRow.ocrError && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="status">{activeRow.ocrError}. U kunt de gegevens handmatig invullen.</p>}

                {activeRow.registeredPayment ? (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4" data-testid="bank-reconciliation-success">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <div>
                      <h4 className="font-black text-emerald-900">Betaling geregistreerd</h4>
                      <p className="mt-1 text-sm font-semibold text-emerald-800">
                        {activeRow.registeredPayment.tenant_name || selectedTenant?.name} · {fmtMoney(activeRow.registeredPayment.amount, activeRow.registeredPayment.currency)}
                        {activeRow.registeredPayment.receipt_number ? ` · bon ${activeRow.registeredPayment.receipt_number}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-emerald-700">Het bewijs is gekoppeld en de factuurverwerking is bijgewerkt.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                        activeRow.matchStatus === 'matched' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-amber-200 bg-amber-50 text-amber-900'
                      }`}>
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-semibold">
                          <span className="mr-2 text-[10px] font-black uppercase tracking-wide opacity-70">Omschrijving uit afschrift</span>
                          {activeRow.description || (activeRow.status === 'ready' && !activeRow.ocrError
                            ? 'Geen omschrijving herkend.'
                            : 'De omschrijving verschijnt zodra de OCR klaar is.')}
                        </p>
                        {activeRow.description && (
                          <p className="mt-0.5 text-xs font-medium">
                              {activeRow.matchStatus === 'matched' && selectedTenant ? `Huurder herkend: ${selectedTenant.name}`
                                : activeRow.matchStatus === 'manual' ? 'Huurder handmatig geselecteerd.'
                                  : activeRow.matchStatus === 'ambiguous' ? 'Meerdere huurders gevonden; controleer uw keuze.'
                                    : 'Geen eenduidige huurder gevonden; selecteer deze handmatig.'}
                          </p>
                        )}
                      </div>
                    </div>

                    <details className="rounded-lg border border-slate-200">
                      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">
                        {activeRow.isStructured ? 'Bankafschrift bekijken' : 'Betaalbewijs en volledige OCR-tekst bekijken'}
                      </summary>
                      <div className="grid gap-3 border-t border-slate-100 p-3 lg:grid-cols-2">
                        <div className="overflow-hidden rounded-lg bg-slate-50">
                          {activeRow.isImage
                            ? <img src={activeRow.previewUrl} alt={`Voorbeeld ${activeRow.file.name}`} className="max-h-72 w-full object-contain p-2" />
                            : <iframe title={`Voorbeeld ${activeRow.file.name}`} src={activeRow.previewUrl} className="h-72 w-full" />}
                        </div>
                        {!activeRow.isStructured && activeRow.ocrText && (
                          <pre className="max-h-72 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap break-words">{activeRow.ocrText}</pre>
                        )}
                      </div>
                    </details>

                    <form className="space-y-3" onSubmit={(event) => registerPayment(event, activeRow)}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label htmlFor={`bank-tenant-search-${activeRow.id}`} className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">Zoek huurder</label>
                          <div className="relative">
                            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <input id={`bank-tenant-search-${activeRow.id}`} value={activeRow.form.tenant_search}
                              onChange={(event) => updateForm(activeRow.id, 'tenant_search', event.target.value)}
                              placeholder="Naam of appartement"
                              className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#FF5C00]" />
                          </div>
                        </div>
                        <div>
                          <label htmlFor={`bank-tenant-${activeRow.id}`} className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">Selecteer huurder</label>
                          <select id={`bank-tenant-${activeRow.id}`} value={activeRow.form.tenant_id}
                            onChange={(event) => updateForm(activeRow.id, 'tenant_id', event.target.value)}
                            required disabled={tenants.length === 0} data-testid="bank-reconciliation-tenant"
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#FF5C00]">
                            <option value="">— Kies huurder —</option>
                            {visibleTenants.map((tenant) => (
                              <option key={tenant.id} value={tenant.id}>
                                {tenant.apartment_number ? `${tenant.apartment_number} · ` : ''}{tenant.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.8fr)_minmax(90px,0.7fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                        <div>
                          <label htmlFor={`bank-amount-${activeRow.id}`} className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">Bedrag</label>
                          <input id={`bank-amount-${activeRow.id}`} type="number" min="0.01" step="0.01" value={activeRow.form.amount}
                            onChange={(event) => updateForm(activeRow.id, 'amount', event.target.value)} required data-testid="bank-reconciliation-amount"
                            className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#FF5C00]" />
                        </div>
                        <div>
                          <label htmlFor={`bank-currency-${activeRow.id}`} className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">Valuta</label>
                          <select id={`bank-currency-${activeRow.id}`} value={activeRow.form.currency}
                            onChange={(event) => updateForm(activeRow.id, 'currency', event.target.value)}
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#FF5C00]">
                            {CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`bank-date-${activeRow.id}`} className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">Betaaldatum</label>
                          <input id={`bank-date-${activeRow.id}`} type="date" value={activeRow.form.paid_date}
                            onChange={(event) => {
                              const value = event.target.value;
                              setRows((current) => current.map((item) => item.id === activeRow.id ? {
                                ...item, form: { ...item.form, paid_date: value, ...datePeriod(value) },
                              } : item));
                            }} required className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#FF5C00]" />
                        </div>
                        <div>
                          <label htmlFor={`bank-category-${activeRow.id}`} className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">Categorie</label>
                          <select id={`bank-category-${activeRow.id}`} value={activeRow.form.category}
                            onChange={(event) => updateForm(activeRow.id, 'category', event.target.value)}
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#FF5C00]">
                            {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        {isPeriodPayment && (
                          <details className="rounded-lg border border-slate-200">
                            <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-600">Huurperiode aanpassen</summary>
                            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-2">
                              <select aria-label="Huurperiode maand" value={activeRow.form.period_month}
                                onChange={(event) => updateForm(activeRow.id, 'period_month', event.target.value)}
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                                {MONTHS_NL.map((month, monthIndex) => <option key={month} value={monthIndex + 1}>{month}</option>)}
                              </select>
                              <input aria-label="Huurperiode jaar" type="number" min="2000" max="2100" value={activeRow.form.period_year}
                                onChange={(event) => updateForm(activeRow.id, 'period_year', event.target.value)}
                                className="h-9 rounded-lg border border-slate-200 px-2 text-sm" />
                            </div>
                          </details>
                        )}

                        <details className="rounded-lg border border-slate-200">
                          <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-600">Extra gegevens</summary>
                          <div className="space-y-2 border-t border-slate-100 p-2">
                            <input aria-label="Naam op bewijs" placeholder="Naam op bewijs" value={activeRow.form.bank_payer_name}
                              onChange={(event) => updateForm(activeRow.id, 'bank_payer_name', event.target.value)}
                              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#FF5C00]" />
                            <input aria-label="Bankreferentie" placeholder="Bankreferentie" value={activeRow.form.bank_reference}
                              onChange={(event) => updateForm(activeRow.id, 'bank_reference', event.target.value)}
                              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#FF5C00]" />
                            <textarea aria-label="Notitie" placeholder="Notitie" rows="2" value={activeRow.form.note}
                              onChange={(event) => updateForm(activeRow.id, 'note', event.target.value)}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#FF5C00]" />
                          </div>
                        </details>
                      </div>

                      {activeRow.saveError && <p className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700" role="alert">{activeRow.saveError}</p>}
                      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
                        <p className="text-xs font-medium text-slate-500">
                          {!activeRow.statement ? 'Bewijs wordt eerst opgeslagen.' : 'Boeking volgt pas na uw bevestiging.'}
                        </p>
                        <button type="submit"
                          disabled={!activeRow.statement || !activeRow.form.tenant_id || Number(activeRow.form.amount) <= 0 || !activeRow.form.paid_date || activeRow.saving || isActiveBusy}
                          data-testid="bank-reconciliation-register"
                          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#FF5C00] px-5 py-2 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto">
                          {activeRow.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          {activeRow.saving ? 'Registreren…' : 'Betaling registreren'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default BankReconciliation;
