import { parseBankStatement } from './bankStatementImport';

describe('parseBankStatement', () => {
  test('parses MT940 credits and skips debits', () => {
    const result = parseBankStatement('statement.mt940', [
      ':60F:C251116SRD1000,00',
      ':61:251116C125,50NTRFNONREF//REF-001',
      ':86:HUUR BETALING JANE DOE',
      ':61:251116D20,00NCHGNONREF//FEE-001',
    ].join('\n'));

    expect(result.transactions).toEqual([{
      date: '2025-11-16',
      amount: 125.5,
      currency: 'SRD',
      description: 'HUUR BETALING JANE DOE',
      payer_name: '',
      reference: 'REF-001',
    }]);
    expect(result.skippedCount).toBe(1);
  });

  test('parses OFX dates, amounts, names, memos, and references', () => {
    const result = parseBankStatement('bank.ofx', [
      '<OFX>',
      '<CURDEF>USD',
      '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20251116120000<TRNAMT>250.00<FITID>TX-123<NAME>Jane Doe<MEMO>November rent</STMTTRN>',
      '</OFX>',
    ].join(''));

    expect(result.transactions).toEqual([{
      date: '2025-11-16',
      amount: 250,
      currency: 'USD',
      description: 'Jane Doe · November rent',
      payer_name: 'Jane Doe',
      reference: 'TX-123',
    }]);
  });

  test('parses semicolon CSV with European decimals and excludes debits', () => {
    const result = parseBankStatement('bank.csv', [
      'Boekdatum;Bedrag;Valuta;Omschrijving;Tegenpartij;Referentie',
      '16-11-2025;1.234,50;EUR;Huur november;Jane Doe;PAY-123',
      '17-11-2025;-25,00;EUR;Bankkosten;Bank;FEE-1',
    ].join('\n'));

    expect(result.transactions).toEqual([{
      date: '2025-11-16',
      amount: 1234.5,
      currency: 'EUR',
      description: 'Huur november',
      payer_name: 'Jane Doe',
      reference: 'PAY-123',
    }]);
    expect(result.skippedCount).toBe(1);
  });

  test('uses the CSV transaction type to exclude positive debit amounts', () => {
    const result = parseBankStatement('bank.csv', [
      'Date,Amount,Type,Description',
      '2025-11-16,100.00,Credit,Rent from Jane Doe',
      '2025-11-16,15.00,Debit,Bank fee',
    ].join('\n'));

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe(100);
    expect(result.skippedCount).toBe(1);
  });

  test('reports CSV files without recognized date and amount columns', () => {
    expect(() => parseBankStatement('bank.csv', 'foo;bar\nx;y'))
      .toThrow('CSV-kolommen niet herkend');
  });
});
