export type CorreiosLabelFormat = '10x15' | 'label10x15' | 'a4';
export function getCorreiosLabelFormat(): CorreiosLabelFormat {
  try { const value = localStorage.getItem('correios-label-format'); return value === 'a4' || value === 'label10x15' ? value : '10x15'; } catch { return '10x15'; }
}
export function saveCorreiosLabelFormat(format: CorreiosLabelFormat) {
  try { localStorage.setItem('correios-label-format', format); } catch { /* Storage denial must not block printing. */ }
}