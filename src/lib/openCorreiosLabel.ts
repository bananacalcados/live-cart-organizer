/** Reserve the tab on the click, before the signed URL request, to avoid popup blocking. */
export function reserveCorreiosPrintTab() {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('Libere as janelas de impressão no navegador e tente novamente.');
  tab.document.title = 'Imprimir etiqueta Correios';
  tab.document.body.textContent = 'Preparando etiqueta…';
  return tab;
}
export async function printCorreiosLabel(tab: Window, url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Não foi possível abrir o PDF da etiqueta.');
  const objectUrl = URL.createObjectURL(await response.blob());
  tab.document.body.textContent = '';
  tab.document.body.style.margin = '0';
  const frame = tab.document.createElement('iframe');
  frame.title = 'Etiqueta Correios';
  frame.style.cssText = 'width:100vw;height:100vh;border:0;display:block';
  frame.onload = () => { window.setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); }, 1000); };
  frame.src = objectUrl;
  tab.document.body.appendChild(frame);
  // Keep the PDF alive until its print tab closes.
  tab.addEventListener('beforeunload', () => URL.revokeObjectURL(objectUrl), { once: true });
}