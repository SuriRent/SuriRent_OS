import { matchBankTenant } from './bankStatementMatching';

const tenants = [
  { id: 'persad', name: 'Johan Persad', apartment_number: 'Huis 3A' },
  { id: 'labi', name: 'Idaila Labi', apartment_number: 'Huis 7C' },
  { id: 'gopaul', name: 'Ravi Gopaul', apartment_number: 'Huis 5B' },
];

describe('matchBankTenant', () => {
  test.each([
    ['HUUR APPT HUIS 3A NOVEMBER 2026 J PERSAD', 'persad'],
    ['HUUR APPT HUIS 7C NOVEMBER 2026 IDAILA LABI', 'labi'],
    ['HUUR APPT HUIS 5B NOVEMBER 2026 R GOPAUL', 'gopaul'],
  ])('matches abbreviated statement description %s', (description, tenantId) => {
    expect(matchBankTenant(description, tenants)).toEqual({ tenantId, status: 'matched' });
  });

  test('uses the apartment number to disambiguate matching initials and surnames', () => {
    const similarTenants = [
      { id: 'ravi', name: 'Ravi Gopaul', apartment_number: 'Huis 5B' },
      { id: 'ramesh', name: 'Ramesh Gopaul', apartment_number: 'Huis 8A' },
    ];

    expect(matchBankTenant('HUUR HUIS 5B R GOPAUL', similarTenants))
      .toEqual({ tenantId: 'ravi', status: 'matched' });
  });

  test('does not choose a tenant when description and apartment point to different people', () => {
    expect(matchBankTenant('HUUR HUIS 3A R GOPAUL', tenants))
      .toEqual({ tenantId: '', status: 'ambiguous' });
  });
});
