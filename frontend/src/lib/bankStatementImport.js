const DATE_HEADERS = ['datum', 'boekdatum', 'transactiedatum', 'valutadatum', 'date', 'booking date', 'transaction date', 'posted date', 'value date'];
const AMOUNT_HEADERS = ['bedrag', 'amount', 'transactiebedrag', 'transaction amount', 'value'];
const CREDIT_HEADERS = ['credit', 'bij', 'bijschrijving', 'ontvangen', 'credit amount'];
const DEBIT_HEADERS = ['debit', 'af', 'afschrijving', 'uitgegeven', 'debit amount'];
const DESCRIPTION_HEADERS = ['omschrijving', 'transactietekst', 'betaalomschrijving', 'mededeling', 'betalingskenmerk', 'description', 'details', 'memo', 'narrative', 'payment details', 'transaction information'];
const PAYER_HEADERS = ['tegenpartij', 'naam tegenpartij', 'naam betaler', 'betaler', 'payer', 'sender', 'counterparty', 'originator', 'name'];
const REFERENCE_HEADERS = ['referentie', 'kenmerk', 'reference', 'transaction id', 'fitid', 'transactie id'];
const CURRENCY_HEADERS = ['valuta', 'currency', 'currency code'];
const DIRECTION_HEADERS = ['debet credit', 'credit debit', 'af bij', 'transaction type', 'transactietype', 'richting', 'direction', 'type'];

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer).replace(/^\uFEFF/, '');
  }
}

function normalizeHeader(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function headerIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.some((alias) => {
    const normalized = normalizeHeader(header);
    return normalized === alias || normalized.startsWith(`${alias} `);
  }));
}

function parseAmount(value) {
  let amount = String(value || '').trim().replace(/[\s\u00a0]/g, '').replace(/[^\d,().+-]/g, '');
  if (!amount) return NaN;
  const negative = amount.startsWith('(') && amount.endsWith(')');
  amount = amount.replace(/[()]/g, '');
  const comma = amount.lastIndexOf(',');
  const dot = amount.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    amount = amount.replace(thousands, '').replace(decimal, '.');
  } else if (comma >= 0) {
    const digitsAfter = amount.length - comma - 1;
    amount = digitsAfter === 3
      ? amount.replace(/,/g, '')
      : amount.replace(/\./g, '').replace(',', '.');
  } else if (dot >= 0 && amount.length - dot - 1 === 3) {
    amount = amount.replace(/\./g, '');
  } else if ((amount.match(/\./g) || []).length > 1) {
    const lastDot = amount.lastIndexOf('.');
    amount = `${amount.slice(0, lastDot).replace(/\./g, '')}${amount.slice(lastDot)}`;
  }
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : NaN;
}

function toIsoDate(value) {
  const raw = String(value || '').trim();
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (match) return validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += year >= 80 ? 1900 : 2000;
    const first = Number(match[1]);
    const second = Number(match[2]);
    return second > 12
      ? validIsoDate(year, first, second)
      : validIsoDate(year, second, first);
  }
  match = raw.match(/^(\d{6})(?:\d{2,6})?$/);
  if (match) {
    const digits = match[1];
    let year = Number(digits.slice(0, 2));
    year += year >= 80 ? 1900 : 2000;
    return validIsoDate(year, Number(digits.slice(2, 4)), Number(digits.slice(4, 6)));
  }
  return '';
}

function validIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseCsv(text) {
  const candidates = [',', ';', '\t'].map((delimiter) => {
    const rows = parseDelimited(text, delimiter);
    const headerRowIndex = rows.findIndex((row) => (
      headerIndex(row, DATE_HEADERS) >= 0
      && (headerIndex(row, AMOUNT_HEADERS) >= 0
        || headerIndex(row, CREDIT_HEADERS) >= 0
        || headerIndex(row, DEBIT_HEADERS) >= 0)
    ));
    return { delimiter, rows, headerRowIndex };
  }).filter((candidate) => candidate.headerRowIndex >= 0);
  if (!candidates.length) {
    throw new Error('CSV-kolommen niet herkend. Het bestand moet datum- en bedragkolommen bevatten.');
  }
  const { rows, headerRowIndex } = candidates.sort((a, b) => (
    rowsScore(b.rows, b.headerRowIndex) - rowsScore(a.rows, a.headerRowIndex)
  ))[0];
  const headers = rows[headerRowIndex].map(normalizeHeader);
  const dateColumn = headerIndex(headers, DATE_HEADERS);
  const amountColumn = headerIndex(headers, AMOUNT_HEADERS);
  const creditColumn = headerIndex(headers, CREDIT_HEADERS);
  const debitColumn = headerIndex(headers, DEBIT_HEADERS);
  const descriptionColumn = headerIndex(headers, DESCRIPTION_HEADERS);
  const payerColumn = headerIndex(headers, PAYER_HEADERS);
  const referenceColumn = headerIndex(headers, REFERENCE_HEADERS);
  const currencyColumn = headerIndex(headers, CURRENCY_HEADERS);
  const directionColumn = headerIndex(headers, DIRECTION_HEADERS);
  const transactions = [];
  let skippedCount = 0;

  rows.slice(headerRowIndex + 1).forEach((row) => {
    const date = toIsoDate(row[dateColumn]);
    if (!date) return;
    let amount;
    if (creditColumn >= 0 || debitColumn >= 0) {
      const credit = parseAmount(row[creditColumn]);
      const debit = parseAmount(row[debitColumn]);
      if (Number.isFinite(credit) && credit > 0) amount = credit;
      else if (Number.isFinite(debit) && debit > 0) amount = -debit;
    } else {
      amount = parseAmount(row[amountColumn]);
    }
    if (Number.isFinite(amount) && amount > 0 && creditColumn < 0 && debitColumn < 0) {
      const direction = normalizeHeader(cell(row, directionColumn));
      if (/\b(debet|debit|afschrijving|withdrawal|outgoing|af)\b/.test(direction)) amount = -amount;
    }
    if (!Number.isFinite(amount) || amount === 0) return;
    if (amount < 0) {
      skippedCount += 1;
      return;
    }
    const description = cell(row, descriptionColumn);
    transactions.push({
      date,
      amount,
      currency: normalizeCurrency(cell(row, currencyColumn)),
      description: description.slice(0, 500),
      payer_name: cell(row, payerColumn).slice(0, 160),
      reference: cell(row, referenceColumn).slice(0, 200),
    });
  });
  return { transactions, skippedCount };
}

function rowsScore(rows, headerRowIndex) {
  return rows.slice(headerRowIndex + 1).filter((row) => row.some(Boolean)).length;
}

function cell(row, index) {
  return index >= 0 ? String(row[index] || '').trim() : '';
}

function normalizeCurrency(value) {
  const currency = String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  return ['SRD', 'USD', 'EUR'].includes(currency) ? currency : 'SRD';
}

function parseMt940(text) {
  const transactions = [];
  const currencyMatch = text.match(/^:60[FM]:[CD]\d{6}([A-Z]{3})/m);
  const statementCurrency = currencyMatch ? currencyMatch[1] : 'SRD';
  let current = null;
  let skippedCount = 0;
  const flush = () => {
    if (!current) return;
    const date = toIsoDate(current.date);
    const amount = parseAmount(current.amount);
    if (date && Number.isFinite(amount) && amount > 0) {
      const description = current.narrative.replace(/\?\d{2}/g, ' ').replace(/\s+/g, ' ').trim();
      transactions.push({
        date,
        amount,
        currency: normalizeCurrency(current.currency),
        description: description.slice(0, 500),
        payer_name: '',
        reference: current.reference,
      });
    } else if (Number.isFinite(amount) && amount < 0) {
      skippedCount += 1;
    }
    current = null;
  };

  text.split(/\r?\n/).forEach((line) => {
    if (line.startsWith(':61:')) {
      flush();
      const match = line.slice(4).match(/^(\d{6})(?:\d{4})?([CD])R?([\d,]+)([A-Z])?(.*)$/);
      if (match) {
        const reference = match[5].includes('//')
          ? match[5].split('//').pop()
          : match[5].trim();
        current = {
          date: match[1],
          amount: match[2] === 'D' ? `-${match[3]}` : match[3],
          currency: statementCurrency,
          reference: reference.slice(0, 200),
          narrative: '',
        };
      }
    } else if (current && line.startsWith(':86:')) {
      current.narrative += ` ${line.slice(4)}`;
    } else if (current && line.startsWith('?')) {
      current.narrative += ` ${line}`;
    }
  });
  flush();
  return { transactions, skippedCount };
}

function readOfxTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return match ? match[1].trim() : '';
}

function parseOfx(text) {
  const transactions = [];
  let skippedCount = 0;
  const statementCurrency = normalizeCurrency(readOfxTag(text, 'CURDEF'));
  const blocks = text.match(/<STMTTRN\b[^>]*>[\s\S]*?<\/STMTTRN\s*>/gi) || [];
  blocks.forEach((block) => {
    const amount = parseAmount(readOfxTag(block, 'TRNAMT'));
    if (!Number.isFinite(amount) || amount === 0) return;
    const type = readOfxTag(block, 'TRNTYPE').toUpperCase();
    if (amount < 0 || /DEBIT|CHECK|FEE|ATM|WITHDRAW/.test(type)) {
      skippedCount += 1;
      return;
    }
    transactions.push({
      date: toIsoDate(readOfxTag(block, 'DTPOSTED')),
      amount,
      currency: normalizeCurrency(readOfxTag(block, 'CURRENCY') || statementCurrency),
      description: [readOfxTag(block, 'NAME'), readOfxTag(block, 'MEMO')].filter(Boolean).join(' · ').slice(0, 500),
      payer_name: readOfxTag(block, 'NAME').slice(0, 160),
      reference: (readOfxTag(block, 'FITID') || readOfxTag(block, 'REFNUM')).slice(0, 200),
    });
  });
  return { transactions: transactions.filter((transaction) => transaction.date), skippedCount };
}

export function parseBankStatement(filename, text) {
  const extension = String(filename || '').toLowerCase().split('.').pop();
  const content = String(text || '');
  const result = extension === 'ofx' || /<OFX\b|OFXHEADER:/i.test(content)
    ? parseOfx(content)
    : ['mt940', 'sta', '940', 'txt'].includes(extension) || /:61:/.test(content)
      ? parseMt940(content)
      : extension === 'csv' || /,|;|\t/.test(content.split(/\r?\n/).find(Boolean) || '')
        ? parseCsv(content)
        : null;
  if (!result) throw new Error('Bestandsformaat niet herkend. Gebruik MT940, OFX of CSV.');
  if (!result.transactions.length) {
    throw new Error(result.skippedCount
      ? 'Geen inkomende betalingen gevonden; uitgaande transacties zijn overgeslagen.'
      : 'Geen transacties met een geldige datum en positief bedrag gevonden.');
  }
  return result;
}

export async function parseBankStatementFile(file) {
  return parseBankStatement(file.name, decodeText(await file.arrayBuffer()));
}
