const HTML_DANFE_REGEX = /(?:^|\/)[^/?#]+\.html(?:$|[?#])/i;

function isHtmlDanfe(url: string) {
  return HTML_DANFE_REGEX.test(url);
}

function ensureUtf8Meta(html: string) {
  if (/<meta[^>]+charset=/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">');
  return `<meta charset="utf-8">${html}`;
}

function injectPrintScript(html: string) {
  const script = '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),120));</script>';
  if (html.includes('</body>')) return html.replace('</body>', `${script}</body>`);
  return `${html}${script}`;
}

export async function openFiscalDocument(url: string, options?: { autoPrint?: boolean }) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Não foi possível abrir a DANFE. Libere pop-ups e tente novamente.');

  if (!isHtmlDanfe(url)) {
    popup.location.href = url;
    return;
  }

  popup.document.write('<html><head><meta charset="utf-8"><title>Carregando DANFE...</title></head><body style="font-family:Arial,sans-serif;padding:16px">Carregando DANFE...</body></html>');
  popup.document.close();

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha ao carregar DANFE (${response.status})`);

    let html = await response.text();
    html = ensureUtf8Meta(html);
    if (options?.autoPrint) html = injectPrintScript(html);

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
  } catch (error) {
    popup.location.href = url;
    throw error;
  }
}