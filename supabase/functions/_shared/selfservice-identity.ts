/** The current event's order identity wins over a phone-shared profile. */
export function orderInstagram(rows: { customer?: { instagram_handle?: string | null } | null }[], fallback?: string | null): string | null {
  const clean = (v?: string | null) => String(v || "").trim().replace(/^@/, "").slice(0, 60);
  if (!rows.length) return clean(fallback) || null;
  const handles = [...new Set(rows.map((r) => clean(r.customer?.instagram_handle)).filter(Boolean))];
  return handles.length === 1 ? handles[0] : null;
}

/** Match the existing database event_phone_key; never mix it with DDD+suffix8. */
export function selfservicePhoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}