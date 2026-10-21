/** Product handles are identifiers, never URLs or paths supplied by a provider. */
const OFFICIAL_STOREFRONT_ORIGIN = "https://bananacalcados.com.br";

export function getOfficialProductUrl(handle: unknown): string {
  if (typeof handle !== "string") return "";
  const identifier = handle.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(identifier)) return "";
  return `${OFFICIAL_STOREFRONT_ORIGIN}/produto/${encodeURIComponent(identifier)}`;
}