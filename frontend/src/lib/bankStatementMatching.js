const APARTMENT_LABELS = new Set([
  'appartement', 'apartment', 'appt', 'apt', 'app', 'huis', 'unit', 'woning', 'room', 'kamer', 'nr', 'no',
]);
const NAME_PREFIXES = new Set(['dhr', 'heer', 'mevr', 'mevrouw', 'mr', 'mrs', 'dr']);

export function normalizeBankText(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalUnit(value) {
  const token = normalizeBankText(value).replace(/\s+/g, '');
  return token.replace(/^0+(?=\d)/, '');
}

function descriptionApartmentUnits(description) {
  const tokens = normalizeBankText(description).split(' ').filter(Boolean);
  const units = new Set();
  tokens.forEach((token, index) => {
    if (!APARTMENT_LABELS.has(token)) return;
    let valueIndex = index + 1;
    while (APARTMENT_LABELS.has(tokens[valueIndex])) valueIndex += 1;
    let value = tokens[valueIndex] || '';
    if (/^\d+$/.test(value) && /^[a-z]$/.test(tokens[valueIndex + 1] || '')) {
      value += tokens[valueIndex + 1];
    }
    if (/^(?:\d+[a-z]?|[a-z]\d+|[a-z])$/.test(value)) {
      units.add(canonicalUnit(value));
    }
  });
  return units;
}

function tenantApartmentUnits(apartmentNumber) {
  const tokens = normalizeBankText(apartmentNumber).split(' ').filter(Boolean);
  const units = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    if (APARTMENT_LABELS.has(tokens[index])) continue;
    const token = tokens[index];
    if (/^\d+$/.test(token) && /^[a-z]$/.test(tokens[index + 1] || '')) {
      units.add(canonicalUnit(`${token}${tokens[index + 1]}`));
      index += 1;
    } else if (/^(?:\d+[a-z]?|[a-z]\d+|[a-z])$/.test(token)) {
      units.add(canonicalUnit(token));
    }
  }
  if (!units.size) {
    const fallback = tokens.filter((token) => !APARTMENT_LABELS.has(token)).join(' ');
    if (fallback) units.add(fallback);
  }
  return units;
}

function tenantNameMatches(description, tenantName) {
  const normalizedDescription = ` ${normalizeBankText(description)} `;
  const tokens = normalizeBankText(tenantName).split(' ')
    .filter((token) => token && !NAME_PREFIXES.has(token));
  if (!tokens.length) return false;
  const fullName = tokens.join(' ');
  if (fullName.length >= 4 && normalizedDescription.includes(` ${fullName} `)) return true;

  const descriptionTokens = new Set(normalizedDescription.trim().split(' '));
  return tokens.some((part, partIndex) => part.length >= 3
    && descriptionTokens.has(part)
    && tokens.some((otherPart, otherIndex) => otherIndex !== partIndex
      && descriptionTokens.has(otherPart.length === 1 ? otherPart : otherPart[0])));
}

export function matchBankTenant(description, tenants) {
  const normalizedDescription = normalizeBankText(description);
  if (!normalizedDescription) return { tenantId: '', status: 'no-description' };

  const apartmentUnits = descriptionApartmentUnits(normalizedDescription);
  const unitMatches = [];
  const nameMatches = [];
  tenants.forEach((tenant) => {
    const tenantUnits = tenantApartmentUnits(tenant.apartment_number);
    if ([...tenantUnits].some((unit) => apartmentUnits.has(unit))) unitMatches.push(tenant.id);
    if (tenantNameMatches(normalizedDescription, tenant.name)) nameMatches.push(tenant.id);
  });

  const uniqueNames = [...new Set(nameMatches)];
  const uniqueUnits = [...new Set(unitMatches)];
  if (uniqueNames.length === 1) {
    const nameMatch = uniqueNames[0];
    if (uniqueUnits.length === 1 && uniqueUnits[0] !== nameMatch) {
      return { tenantId: '', status: 'ambiguous' };
    }
    return { tenantId: nameMatch, status: 'matched' };
  }
  if (uniqueNames.length > 1) {
    const disambiguated = uniqueUnits.filter((tenantId) => uniqueNames.includes(tenantId));
    return disambiguated.length === 1
      ? { tenantId: disambiguated[0], status: 'matched' }
      : { tenantId: '', status: 'ambiguous' };
  }
  if (uniqueUnits.length === 1) return { tenantId: uniqueUnits[0], status: 'matched' };
  return uniqueUnits.length > 1
    ? { tenantId: '', status: 'ambiguous' }
    : { tenantId: '', status: 'unmatched' };
}
