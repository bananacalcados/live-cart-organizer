/**
 * Detect if a digits-only phone string is clearly a non-Brazilian international number.
 * Conservative: only returns true when the number has 11+ digits AND starts with a
 * known foreign country code. Brazilian numbers (10-11 digits without DDI, or 12-13
 * starting with 55) always return false to preserve existing behavior.
 */
function isInternationalNonBR(digits: string): boolean {
  if (!digits) return false;
  // BR numbers with DDI are 12 (landline) or 13 (mobile) digits starting with 55
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return false;
  // Local BR formats (10 or 11 digits, no DDI) — assumed BR
  if (digits.length <= 11) return false;

  // Common non-BR country codes (1=US/CA, 351=PT, 44=UK, 34=ES, 33=FR, 49=DE, 39=IT,
  // 351=PT, 1=US/CA, 52=MX, 54=AR, 56=CL, 57=CO, 58=VE, 595=PY, 598=UY, 591=BO,
  // 593=EC, 51=PE, 81=JP, 86=CN, 91=IN, 61=AU, 64=NZ, 27=ZA, 351=PT, 31=NL, 32=BE,
  // 41=CH, 43=AT, 45=DK, 46=SE, 47=NO, 48=PL, 90=TR, 971=AE, 972=IL, 974=QA, 966=SA)
  // Heuristic: any 12+ digit number that does NOT start with 55 is treated as international.
  return !digits.startsWith('55');
}

/**
 * Normalize a Brazilian phone number to E.164 standard (55 + DDD + 9 + number).
 * Ensures the 9th digit is always present for mobile numbers.
 * For international numbers (non-BR), returns digits-only without forcing the 55 prefix.
 */
export function normalizeBRPhone(raw: string): string {
  let phone = raw.replace(/\D/g, '');
  if (!phone) return '';

  // International (non-BR) number: return digits as-is, no 55 prefix, no 9th digit injection
  if (isInternationalNonBR(phone)) {
    return phone;
  }

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
