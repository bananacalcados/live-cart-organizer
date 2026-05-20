const HTML_DANFE_REGEX = /(?:^|\/)[^/?#]+\.html(?:$|[?#])/i;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const FISCAL_RENDER_PATH = '/functions/v1/fiscal-render-document';

function isHtmlDanfe(url: string) {
  return HTML_DANFE_REGEX.test(url);
}

function isFiscalRenderUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname === FISCAL_RENDER_PATH;
  } catch {
    return false;
  }
}

function buildFiscalRenderUrl(url: string, options?: { autoPrint?: boolean }) {
  const endpoint = new URL('/functions/v1/fiscal-render-document', SUPABASE_URL);
  endpoint.searchParams.set('url', url);
  if (options?.autoPrint) endpoint.searchParams.set('autoprint', '1');
  return endpoint.toString();
}

function buildDanfeFetchUrl(url: string, options?: { autoPrint?: boolean }) {
  const endpoint = isFiscalRenderUrl(url) ? new URL(url) : new URL(buildFiscalRenderUrl(url, options));
  if (options?.autoPrint) endpoint.searchParams.set('autoprint', '1');
  endpoint.searchParams.set('raw', '1');
  endpoint.searchParams.set('_ts', `${Date.now()}`);
  return endpoint.toString();
}

export async function openFiscalDocument(url: string, options?: { autoPrint?: boolean }) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Não foi possível abrir a DANFE. Libere pop-ups e tente novamente.');

  const shouldRenderAsHtml = isHtmlDanfe(url) || isFiscalRenderUrl(url);

  if (!shouldRenderAsHtml) {
    popup.location.href = url;
    return;
  }

  popup.document.write('<html><head><meta charset="utf-8"><title>Carregando DANFE...</title></head><body style="font-family:Arial,sans-serif;padding:16px">Carregando DANFE...</body></html>');
  popup.document.close();

  try {
    const response = await fetch(buildDanfeFetchUrl(url, options), {
      method: 'GET',
      headers: { Accept: 'text/plain, text/html;q=0.9,*/*;q=0.8' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Não foi possível carregar a DANFE para impressão.');
    }

    const html = await response.text();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    popup.location.replace(blobUrl);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (error) {
    popup.close();
    throw error instanceof Error ? error : new Error('Não foi possível carregar a DANFE.');
  }
}