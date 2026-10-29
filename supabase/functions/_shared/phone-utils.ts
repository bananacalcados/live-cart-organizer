export function normalizeBRPhone(raw: string): string {
  let d=raw.replace(/\D/g,"");
  if (d.length===10 || d.length===11) d=`55${d}`;
  if (d.startsWith("55") && d.length===12) d=`${d.slice(0,4)}9${d.slice(4)}`;
  return d;
}
export function buildPhoneVariations(raw: string): string[] {
  const normalized=normalizeBRPhone(raw);
  const local=normalized.startsWith("55") ? normalized.slice(2) : normalized;
  const without9=local.length===11 && local[2]==="9" ? local.slice(0,2)+local.slice(3) : local;
  return [...new Set([raw.replace(/\D/g,""),normalized,local,without9,`55${without9}`])];
}