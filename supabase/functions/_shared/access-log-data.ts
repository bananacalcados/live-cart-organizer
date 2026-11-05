export function clipped(value: string | null | undefined): string | null {
  return value ? value.slice(0, 500) : null;
}

export function accessMetadata(req: Request) {
  const url = new URL(req.url);
  const chain = req.headers.get('x-forwarded-for');
  return {
    method: clipped(req.method),
    // Query values can contain checkout/OBS/session tokens. Never persist them.
    path: clipped(url.pathname.replace(/\/[a-zA-Z0-9_-]{24,}(?=\/|$)/g, '/[redacted]')),
    ip: clipped(req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || chain?.split(',')[0]?.trim()),
    ip_chain: clipped(chain),
    user_agent: clipped(req.headers.get('user-agent')),
    origin: clipped(req.headers.get('origin')),
    referer: clipped(req.headers.get('referer')?.split('?')[0]?.split('#')[0]),
  };
}

export function internalCredentialsMatch(token: string, provided: string, service: string, secret: string): boolean {
  return Boolean(service && secret && token === service && provided === secret);
}

export function sensitiveAction(name: string): boolean {
  return /^(admin-|inventory-correct-stock$|pos-tiny-delete-sale$|contact-erase$|pos-exchange-stock-adjust$)/.test(name)
    || /refund|estorno|dispatch|campaign|campanha|group.*(?:send|execute|process)|send.*group/.test(name);
}