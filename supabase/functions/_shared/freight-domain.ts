export interface FreightPackage { peso_g: number; c: number; l: number; a: number; itens: number; origem: 'produtos' | 'padrao' }
export interface FreightOption { source: 'correios' | 'frenet'; carrier: string; service: string; service_code: string; price: number; delivery_days: number | null; note: string; shipping_carrier: string; shipping_type: 'correios' | 'transportadora' }
export function parseBrl(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
}
export function tokenNeedsRenewal(expiry: string | null, now = Date.now()) {
  return !expiry || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) - now < 30 * 60 * 1000;
}
export function validatePackage(p: FreightPackage): FreightPackage {
  if (![p.peso_g, p.c, p.l, p.a, p.itens].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Peso e medidas devem ser maiores que zero');
  if (p.c < 15 || p.l < 10 || p.a < 1) throw new Error('Pacote mínimo Correios: 15 × 10 × 1 cm');
  if (Math.max(p.c, p.l, p.a) > 100 || p.c + p.l + p.a > 200) throw new Error('Pacote excede os limites Correios: 100 cm por lado e soma de até 200 cm');
  return p;
}
export interface PackageItem { quantity: number; variantWeight?: unknown; masterWeight?: unknown; categoryWeight?: unknown; length?: unknown; width?: unknown; height?: unknown; categoryLength?: unknown; categoryWidth?: unknown; categoryHeight?: unknown }
const positive = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0;
export function buildPackage(items: PackageItem[]): FreightPackage {
  let weight = 0, c = 15, l = 10, a = 0, count = 0, defaulted = false;
  for (const item of items) {
    const qty = item.quantity;
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantidade inválida nos itens da Conferência');
    const productWeight = positive(item.variantWeight) || positive(item.masterWeight);
    const length = positive(item.length), width = positive(item.width), height = positive(item.height);
    if (!productWeight || !length || !width || !height) defaulted = true;
    weight += (productWeight || positive(item.categoryWeight) || 0.7) * qty;
    c = Math.max(c, length || positive(item.categoryLength) || 30);
    l = Math.max(l, width || positive(item.categoryWidth) || 20);
    a += (height || positive(item.categoryHeight) || 12) * qty;
    count += qty;
  }
  if (!count) throw new Error('Sem itens destinados à Conferência para cotar');
  return validatePackage({ peso_g: Math.ceil(weight * 1000), c: Math.ceil(c), l: Math.ceil(l), a: Math.max(1, Math.ceil(a)), itens: count, origem: defaulted ? 'padrao' : 'produtos' });
}
export function standardCarrier(carrier: string, service: string): Pick<FreightOption, 'shipping_carrier' | 'shipping_type'> {
  const name = `${carrier} ${service}`.toLowerCase();
  if (name.includes('correio') || name.includes('sedex') || /\bpac\b/.test(name)) return { shipping_carrier: name.includes('sedex') ? 'Correios SEDEX' : 'Correios PAC', shipping_type: 'correios' };
  const canonical = name.includes('j&t') || name.includes('jet express') ? 'J&T Express' : name.includes('jadlog') ? 'Jadlog' : name.includes('loggi') ? 'Loggi' : carrier;
  return { shipping_carrier: canonical, shipping_type: 'transportadora' };
}
export function localDelivery(sale: { is_store_pickup?: boolean; shipping_type?: string | null; shipping_carrier?: string | null }) {
  const text = `${sale.shipping_type || ''} ${sale.shipping_carrier || ''}`.toLowerCase();
  return !!sale.is_store_pickup || /retirada|pickup|motot[aá]xi/.test(text);
}