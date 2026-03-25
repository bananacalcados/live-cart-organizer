/**
 * Normalize a Brazilian phone number to E.164 standard (55 + DDD + 9 + number).
 * Ensures the 9th digit is always present for mobile numbers.
 * For international numbers (non-BR), returns as-is with digits only.
 */
export function normalizeBRPhone(raw: string): string {
  let phone = raw.replace(/\D/g, '');
  if (!phone) return '';

  // Add country code if missing
  if (phone.length >= 10 && phone.length <= 11) {
    phone = '55' + phone;
  }

  // If 12-digit BR number (55 + DDD + 8 digits), inject the 9th digit
  if (phone.startsWith('55') && phone.length === 12) {
    const ddd = phone.substring(2, 4);
    const number = phone.substring(4);
    phone = '55' + ddd + '9' + number;
  }

  return phone;
}

/**
 * Build all possible phone variations for matching messages in the database.
 * This handles cases where some messages were saved with/without 9th digit or country code.
 */
export function buildPhoneVariations(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return [];

  const normalized = normalizeBRPhone(raw);
  const withoutCountry = normalized.startsWith('55') ? normalized.slice(2) : normalized;

  // For 9-digit mobile numbers, also try without the 9
  const without9 = withoutCountry.length === 11 && withoutCountry.charAt(2) === '9'
    ? withoutCountry.slice(0, 2) + withoutCountry.slice(3)
    : null;

  return [
    normalized,
    digits,
    withoutCountry,
    without9,
    without9 ? '55' + without9 : null,
  ].filter(Boolean) as string[];
}
