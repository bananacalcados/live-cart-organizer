// Render a Meta WhatsApp template into the full human-readable message
// (header/body/footer/buttons with variables substituted) plus header media,
// so the chat shows the real content instead of "[template:name] p1 | p2".

const _templateDefCache = new Map<string, any>();

export async function fetchTemplateDef(
  accessToken: string,
  businessAccountId: string,
  templateName: string,
  language?: string,
): Promise<any | null> {
  if (!accessToken || !businessAccountId || !templateName) return null;
  const cacheKey = `${businessAccountId}:${templateName}`;
  let list = _templateDefCache.get(cacheKey);
  if (!list) {
    try {
      const url = `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates?name=${encodeURIComponent(templateName)}&limit=10`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const json = await res.json();
      if (!res.ok) return null;
      list = json.data || [];
      _templateDefCache.set(cacheKey, list);
    } catch (_e) {
      return null;
    }
  }
  if (!list || list.length === 0) return null;
  const byName = list.filter((t: any) => t.name === templateName);
  return byName.find((t: any) => t.language === language) || byName[0] || null;
}

function paramVal(p: any): string {
  if (!p) return '';
  if (typeof p.text === 'string') return p.text;
  if (p.currency?.fallback_value) return p.currency.fallback_value;
  if (p.date_time?.fallback_value) return p.date_time.fallback_value;
  return '';
}

export function renderTemplateMessage(
  def: any,
  sentComponents: any[] | undefined,
): { text: string; mediaUrl: string | null; mediaType: string } {
  const sent = sentComponents || [];
  const findSent = (type: string) =>
    sent.find((c: any) => (c.type || '').toLowerCase() === type);

  const subst = (text: string, params: any[]) =>
    text.replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => {
      const idx = parseInt(n, 10) - 1;
      const v = paramVal(params?.[idx]);
      return v || `{{${n}}}`;
    });

  const parts: string[] = [];
  let mediaUrl: string | null = null;
  let mediaType = 'text';

  for (const comp of def?.components || []) {
    const type = (comp.type || '').toUpperCase();
    if (type === 'HEADER') {
      const format = (comp.format || 'TEXT').toUpperCase();
      const hp = findSent('header')?.parameters || [];
      if (format === 'TEXT' && comp.text) {
        parts.push(`*${subst(comp.text, hp)}*`);
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
        const mp = hp[0] || {};
        const link =
          mp.image?.link || mp.video?.link || mp.document?.link ||
          comp.example?.header_handle?.[0] || null;
        if (link) {
          mediaUrl = link;
          mediaType = format.toLowerCase();
        }
      }
    } else if (type === 'BODY' && comp.text) {
      const bp = findSent('body')?.parameters || [];
      parts.push(subst(comp.text, bp));
    } else if (type === 'FOOTER' && comp.text) {
      parts.push(`_${comp.text}_`);
    } else if (type === 'BUTTONS' && Array.isArray(comp.buttons)) {
      const labels = comp.buttons
        .map((b: any) => (b.text ? `▸ ${b.text}` : ''))
        .filter(Boolean)
        .join('\n');
      if (labels) parts.push(labels);
    }
  }

  return { text: parts.join('\n\n'), mediaUrl, mediaType };
}
