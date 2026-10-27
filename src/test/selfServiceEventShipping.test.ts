import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const event = { operation_mode: 'whatsapp_autoatendimento', default_shipping_cost: 19.99, free_shipping_threshold: 299.98 };
const order = { products: [{ price: 139.99, quantity: 1 }], free_shipping: false, shipping_cost: 0 };
const cases = [
  ['139.99 charges 19.99', {}, {}, { shipping_cost: 19.99, free_shipping: false }],
  ['299.98 charges 19.99', { products: [{ price: 299.98, quantity: 1 }] }, {}, { shipping_cost: 19.99, free_shipping: false }],
  ['299.99 gets free freight', { products: [{ price: 299.99, quantity: 1 }] }, {}, { shipping_cost: 0, free_shipping: true }],
  ['manual exemption', { free_shipping: true }, {}, null],
  ['manual freight', { shipping_cost: 12.5 }, {}, null],
  ['manual zero', { custom_shipping_cost: 0 }, {}, null],
  ['pickup', { is_pickup: true }, {}, null],
  ['paid', { is_paid: true }, {}, null],
  ['provider attempt', { mercadopago_payment_id: 'pending' }, {}, null],
  ['manual live unchanged', {}, { operation_mode: 'whatsapp' }, null],
  ['discount lowers eligibility', { products: [{ price: 350, quantity: 1 }], discount_type: 'fixed', discount_value: 60 }, {}, { shipping_cost: 19.99, free_shipping: false }],
  ['automatic exemption recalculated', { free_shipping: true, shipping_info: { source: 'event_rule', price: 0 } }, {}, { shipping_cost: 19.99, free_shipping: false }],
] as const;

describe('persisted self-service event shipping', () => {
  it('executes every rule against the installed database function', () => {
    const literal = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
    const sql = `SELECT ${cases.map(([name, patch, eventPatch, expected], i) => `public.resolve_selfservice_event_shipping(${literal({ ...order, ...patch })},${literal({ ...event, ...eventPatch })}) IS NOT DISTINCT FROM ${expected === null ? 'NULL::jsonb' : literal(expected)} AS rule_${i}`).join(',')}`;
    const output = execFileSync('lovable', ['supabase', 'query', sql, '--json'], { encoding: 'utf8' });
    const result = JSON.parse(output);
    const text = JSON.stringify(result);
    cases.forEach(([name], i) => {
      expect(text, name).toMatch(new RegExp(`"rule_${i}"\\s*:\\s*true`));
    });
  }, 60000);
});