const HTML_DANFE_REGEX = /(?:^|\/)[^/?#]+\.html(?:$|[?#])/i;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

function isHtmlDanfe(url: string) {
  return HTML_DANFE_REGEX.test(url);
}

function buildFiscalRenderUrl(url: string, options?: { autoPrint?: boolean }) {
  const endpoint = new URL('/functions/v1/fiscal-render-document', SUPABASE_URL);
  endpoint.searchParams.set('url', url);
  if (options?.autoPrint) endpoint.searchParams.set('autoprint', '1');
  return endpoint.toString();
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
  popup.location.replace(buildFiscalRenderUrl(url, options));
}