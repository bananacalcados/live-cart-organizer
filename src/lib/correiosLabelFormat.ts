export type CorreiosLabelFormat = 'propria_10x15' | 'oficial_10x15' | 'propria_a4' | 'oficial_a4';
export const CORREIOS_LABEL_FORMATS: { value: CorreiosLabelFormat; label: string }[] = [
  { value: 'propria_10x15', label: 'Etiqueta 10×15 (ERP)' },
  { value: 'oficial_10x15', label: 'Rótulo oficial Correios 10×15' },
  { value: 'propria_a4', label: 'Folha A4 (ERP)' },
  { value: 'oficial_a4', label: 'Folha A4 oficial + DANFE' },
];
/** Older saved choices: only-label and A4 map to the official formats; anything else uses the ERP label. */
export function normalizeCorreiosLabelFormat(value: string | null | undefined): CorreiosLabelFormat {
  if (CORREIOS_LABEL_FORMATS.some((f) => f.value === value)) return value as CorreiosLabelFormat;
  if (value === 'label10x15') return 'oficial_10x15';
  if (value === 'a4') return 'oficial_a4';
  return 'propria_10x15';
}
export function getCorreiosLabelFormat(): CorreiosLabelFormat {
  try { return normalizeCorreiosLabelFormat(localStorage.getItem('correios-label-format')); } catch { return 'propria_10x15'; }
}
export function saveCorreiosLabelFormat(format: CorreiosLabelFormat) {
  try { localStorage.setItem('correios-label-format', format); } catch { /* Storage denial must not block printing. */ }
}
export function correiosLabelUrl(s: { own_url?: string | null; own_a4_url?: string | null; thermal_label_url?: string | null; a4_url?: string | null }, format: CorreiosLabelFormat) {
  return { propria_10x15: s.own_url, propria_a4: s.own_a4_url, oficial_10x15: s.thermal_label_url, oficial_a4: s.a4_url }[format] || null;
}
