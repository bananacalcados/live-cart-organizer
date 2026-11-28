import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

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
  let result: Record<string, boolean>;
  beforeAll(() => {
    const literal = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    const sql = `SELECT ${cases.map(([name, patch, eventPatch, expected], i) => `public.resolve_selfservice_event_shipping(${literal({ ...order, ...patch })},${literal({ ...event, ...eventPatch })}) IS NOT DISTINCT FROM ${expected === null ? 'NULL::jsonb' : literal(expected)} AS rule_${i}`).join(',')}`;
    // Same versioned PL/pgSQL resolver, with its restricted grants, in a disposable local database.
    // No public grant, production query or customer data is needed to test a pure JSON calculation.
    const resolver = readFileSync('drizzle/migrations/0072_selfservice_event_shipping_default.sql', 'utf8')
      .split('CREATE OR REPLACE FUNCTION public.apply_selfservice_event_shipping()')[0];
    const output = execFileSync('bash', ['src/test/runEventShippingIsolated.sh'], {
      encoding: 'utf8',
      input: `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;\n${resolver}\nSET ROLE authenticated;\nSELECT row_to_json(r) FROM (${sql}, NOT has_function_privilege('anon','public.resolve_selfservice_event_shipping(jsonb,jsonb)','EXECUTE') AS anon_blocked) r;`,
    });
    result = JSON.parse(output.trim());
  }, 60000);
  cases.forEach(([name], i) => {
    it(name, () => expect(result[`rule_${i}`]).toBe(true));
  });
  it('does not grant public/anonymous execution to make the test pass', () => expect(result.anon_blocked).toBe(true));
});