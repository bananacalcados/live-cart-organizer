-- Synthetic, disposable local PostgreSQL only. No production writes.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.has_module_access(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE live_presenter_products(event_id uuid, code text, created_at timestamptz);
CREATE TABLE product_color_codes(code text, master_id uuid, color text);
CREATE TABLE product_variants(id uuid, master_id uuid, size text, color text, gtin text, sku text, is_active boolean);
CREATE TABLE pos_stores(id uuid, is_active boolean, is_simulation boolean);
CREATE TABLE pos_products(id uuid, store_id uuid, barcode text, sku text, stock numeric);
CREATE TABLE pos_stock_adjustments(product_id uuid, store_id uuid, movement_type text, sale_event text, sale_id uuid, created_at timestamptz);
CREATE TABLE pos_sales(id uuid, status text, status_cancelamento text, expedition_stage text, created_at timestamptz);
CREATE TABLE pos_sale_items(id uuid, sale_id uuid, barcode text, sku text, quantity integer);
\ir ../../docs/database/20261121143000_presenter_available_pairs.sql

INSERT INTO live_presenter_products VALUES ('00000000-0000-0000-0000-000000000001','X',now());
INSERT INTO product_color_codes VALUES ('X','00000000-0000-0000-0000-000000000010','Preto');
INSERT INTO product_variants VALUES ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010','36',' preto ','GTIN36','SKU36',true);
INSERT INTO pos_stores VALUES ('00000000-0000-0000-0000-000000000020',true,false),('00000000-0000-0000-0000-000000000021',true,false),('00000000-0000-0000-0000-000000000022',true,true);
INSERT INTO pos_products VALUES ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','GTIN36','SKU36',5),('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000021','GTIN36','SKU36',0),('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000022','GTIN36','SKU36',99);
INSERT INTO pos_sales VALUES ('00000000-0000-0000-0000-000000000040','paid','ativo','conferencia','2026-11-19');
INSERT INTO pos_sale_items VALUES ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000040','GTIN36','SKU36',4);
INSERT INTO pos_stock_adjustments VALUES ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','venda','sale','00000000-0000-0000-0000-000000000040','2026-11-19'),('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','balanco',null,null,'2026-11-20');
CREATE FUNCTION assert_pairs(want_stock numeric, want_pending numeric, want_available numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE j jsonb;
BEGIN
 SELECT sizes->0 INTO j FROM live_presenter_available_pairs('00000000-0000-0000-0000-000000000001');
 IF (j->>'total_stock')::numeric IS DISTINCT FROM want_stock OR (j->>'pending_pairs')::numeric IS DISTINCT FROM want_pending OR (j->>'available_pairs')::numeric IS DISTINCT FROM want_available THEN
   RAISE EXCEPTION 'Expected %/%/%, got %',want_stock,want_pending,want_available,j;
 END IF;
END $$;
-- User example: all real stores 5, 4 earlier pending = 1; simulation 99 excluded.
SELECT assert_pairs(5,4,1);
-- Multiple balances never count an item twice.
INSERT INTO pos_stock_adjustments VALUES ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','balanco',null,null,'2026-11-20 18:00');
SELECT assert_pairs(5,4,1);
-- Later sale already reduced stock: 4 - 4 = 0, NOT a second deduction.
INSERT INTO pos_sales VALUES ('00000000-0000-0000-0000-000000000041','completed',null,'conferencia','2026-11-21');
INSERT INTO pos_sale_items VALUES ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000041','GTIN36','SKU36',1);
INSERT INTO pos_stock_adjustments VALUES ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','venda','sale','00000000-0000-0000-0000-000000000041','2026-11-21');
UPDATE pos_products SET stock=4 WHERE id='00000000-0000-0000-0000-000000000030';
SELECT assert_pairs(4,4,0);
-- Negative saldo clamps to zero.
UPDATE pos_products SET stock=-1 WHERE id='00000000-0000-0000-0000-000000000030';
SELECT assert_pairs(-1,4,0);
UPDATE pos_products SET stock=5 WHERE id='00000000-0000-0000-0000-000000000030';
-- Completed shipment, cancellation, or unpaid row never contributes.
UPDATE pos_sales SET expedition_stage='concluido' WHERE id='00000000-0000-0000-0000-000000000040';
SELECT assert_pairs(5,0,5);
UPDATE pos_sales SET expedition_stage='conferencia',status_cancelamento='cancelado' WHERE id='00000000-0000-0000-0000-000000000040';
SELECT assert_pairs(5,0,5);
UPDATE pos_sales SET status_cancelamento='ativo',status='pending' WHERE id='00000000-0000-0000-0000-000000000040';
SELECT assert_pairs(5,0,5);
UPDATE pos_sales SET status='paid' WHERE id='00000000-0000-0000-0000-000000000040';
-- A balance in a different store must not deduct this sale.
UPDATE pos_stock_adjustments SET product_id='00000000-0000-0000-0000-000000000031',store_id='00000000-0000-0000-0000-000000000021' WHERE movement_type='balanco';
SELECT assert_pairs(5,0,5);
-- Asynchronous payment after count: created order alone is not a stock deduction.
UPDATE pos_stock_adjustments SET product_id='00000000-0000-0000-0000-000000000030',store_id='00000000-0000-0000-0000-000000000020' WHERE movement_type='balanco';
UPDATE pos_stock_adjustments SET created_at='2026-11-21' WHERE sale_id='00000000-0000-0000-0000-000000000040';
SELECT assert_pairs(5,0,5);
-- Another real store contributes its saldo.
UPDATE pos_products SET stock=2 WHERE id='00000000-0000-0000-0000-000000000031';
SELECT assert_pairs(7,0,7);
-- Legacy exact SKU fallback, no GTIN, still resolves both physical stores.
UPDATE product_variants SET gtin=null;
SELECT assert_pairs(7,0,7);
-- Event isolation.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM live_presenter_available_pairs('00000000-0000-0000-0000-000000000099')) THEN RAISE EXCEPTION 'event leak'; END IF; END $$;
-- Permission guard is server-side, never anon.
CREATE OR REPLACE FUNCTION public.has_module_access(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
DO $$ BEGIN
 BEGIN PERFORM live_presenter_available_pairs('00000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'permission not enforced';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','live_presenter_available_pairs(uuid,integer,integer)','execute') THEN RAISE EXCEPTION 'anon access'; END IF;
END $$;