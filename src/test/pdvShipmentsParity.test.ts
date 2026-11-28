import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

// Execute the versioned SQL, not a JS substitute, in a disposable socket-only PostgreSQL.
const migration = readFileSync('drizzle/migrations/0317_pdv_shipments_pages_and_private_doorbells.sql', 'utf8').split('CREATE OR REPLACE FUNCTION public.pdv_sales_doorbell')[0];
const store = '00000000-0000-0000-0000-000000000001';
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const sales = Array.from({ length: 230 }, (_, i) => ({ id: uuid(i + 10), created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), expedition_status: ['pending', 'separating', 'packed', 'shipped'][i % 4], name: `Cliente ${i}`, sku: `SKU-${i}`, quantity: i % 3 + 1 }));
const scope = [...sales].reverse().slice(0, 200);
const cases = [ ['all', '', 0], ['all', '', 50], ['pending', '', 0], ['shipped', '', 0], ['all', 'cliente 219', 0], ['all', 'sku-229', 0], ['all', 'ausente', 0] ] as const;

describe('Envios before/after: identical legacy scope, order, counters and fallback', () => {
  let results: any[];
  beforeAll(() => {
    const setup = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE pos_sales(id uuid,store_id uuid,seller_id uuid,customer_id uuid,subtotal numeric,discount numeric,total numeric,status text,sale_type text,payment_gateway text,expedition_status text,tracking_code text,shipped_at timestamptz,shipping_address jsonb,shipping_notes text,notes text,tiny_order_id text,tiny_order_number text,created_at timestamptz,payment_details jsonb);
CREATE TABLE pos_customers(id uuid,name text,whatsapp text,cep text,city text,state text,address text);
CREATE TABLE pos_sellers(id uuid,name text);
CREATE TABLE pos_checkout_attempts(sale_id text,customer_name text,customer_phone text,created_at timestamptz);
CREATE TABLE pos_sale_items(id uuid,sale_id uuid,sku text,product_name text,variant_name text,size text,quantity integer,unit_price numeric,total_price numeric);
CREATE TABLE companies(id uuid,cnpj text);
CREATE TABLE fiscal_documents(pos_sale_id uuid,status text,danfe_url text,numero integer,company_id uuid,created_at timestamptz);
${migration}
${sales.map(s => `INSERT INTO pos_sales(id,store_id,customer_id,subtotal,discount,total,status,sale_type,expedition_status,created_at) VALUES('${s.id}','${store}','${s.id}',100,0,100,'paid','online','${s.expedition_status}','${s.created_at}'); INSERT INTO pos_customers(id,name,whatsapp) VALUES('${s.id}','${s.name}','55999999999'); INSERT INTO pos_sale_items(id,sale_id,sku,product_name,quantity,unit_price,total_price) VALUES('${s.id}','${s.id}','${s.sku}','Tenis ${s.name}',${s.quantity},100,${s.quantity * 100});`).join('\n')}
-- The old map overwrote newest-first attempts: preserve that oldest named fallback.
UPDATE pos_sales SET customer_id=NULL WHERE id='${uuid(239)}';
INSERT INTO pos_checkout_attempts VALUES('${uuid(239)}','Cliente 229','55999999999','2026-01-01'),('${uuid(239)}','Outro nome','55888888888','2026-01-02');
${cases.map(([f, q, o]) => `SELECT pos_shipments_page('${store}','${f}','${q}',50,${o});`).join('\n')}
SELECT jsonb_build_object('blocked',NOT has_function_privilege('anon','pos_shipments_page(uuid,text,text,integer,integer)','EXECUTE'));`;
    results = execFileSync('bash', ['src/test/runEventShippingIsolated.sh'], { input: setup, encoding: 'utf8' }).trim().split('\n').map(s => JSON.parse(s));
  }, 60000);
  cases.forEach(([filter, search, offset], i) => {
    it(`${filter}/${search || 'no search'}/offset ${offset}`, () => {
      // Frozen pre-delivery filtering/order/counting semantics, with the same legacy 200 rows.
      const filtered = scope.filter(s => (filter === 'all' || s.expedition_status === filter) && (!search || s.name.toLowerCase().includes(search) || s.sku.toLowerCase().includes(search)));
      const out = results[i];
      expect(out.orders.map((r: any) => r.id)).toEqual(filtered.slice(offset, offset + 50).map(s => s.id));
      expect(out.total).toBe(filtered.length);
      expect(out.counts).toEqual({ all: 200, pending: 50, separating: 50, packed: 50, shipped: 50 });
      for (const row of out.orders) {
        const original = sales.find(s => s.id === row.id);
        expect(row.customer_name).toBe(original?.name);
        expect(row.items[0].sku).toBe(original?.sku);
        expect(row.items[0].quantity).toBe(original?.quantity);
      }
    });
  });
  it('does not open public execution for tests', () => expect(results[7].blocked).toBe(true));
});
