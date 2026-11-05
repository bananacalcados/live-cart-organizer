import { describe,it,expect } from 'vitest';
import { accessMetadata,clipped,internalCredentialsMatch,sensitiveAction } from '../../supabase/functions/_shared/access-log-data';
describe('security access metadata',() => {
 it('truncates stored strings to 500 characters',() => { expect(clipped('a'.repeat(501))).toHaveLength(500); });
 it('does not persist authorization or checkout query secrets',() => {
  const metadata = accessMetadata(new Request('https://example.test/functions/v1/checkout?token=private',{ headers:{ authorization:'Bearer private',referer:'https://example.test/cart?ml=private','x-forwarded-for':'85.155.15.137, 10.0.0.1' } }));
  expect(metadata.path).toBe('/functions/v1/checkout'); expect(metadata.referer).toBe('https://example.test/cart');
  expect(metadata.ip).toBe('85.155.15.137'); expect(JSON.stringify(metadata)).not.toContain('private');
 });
 it('requires both service credential and internal secret',() => {
  expect(internalCredentialsMatch('service','','service','secret')).toBe(false);
  expect(internalCredentialsMatch('anon','secret','service','secret')).toBe(false);
  expect(internalCredentialsMatch('service','secret','service','secret')).toBe(true);
 });
 it('audits refunds and mass sends',() => { expect(sensitiveAction('gateway-refund')).toBe(true); expect(sensitiveAction('zapi-group-campaign-execute')).toBe(true); expect(sensitiveAction('produto-ativo')).toBe(false); });
});