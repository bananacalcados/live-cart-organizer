\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE supabase_read_only_user;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE TABLE pos_sales (
 id uuid PRIMARY KEY, status text DEFAULT 'paid', status_cancelamento text DEFAULT 'ativo',
 sales_channel text DEFAULT 'live', sale_type text DEFAULT 'live',
 source_order_id uuid, external_order_id text, tiny_order_number text,
 customer_name text, customer_phone text, customer_city text, customer_state text, customer_cep text,
 shipping_address jsonb, payment_details jsonb, tracking_carrier text, shipping_carrier text,
 expedition_stage text, expedition_finished_at timestamptz, shipped_at timestamptz, shipped_source text,
 is_store_pickup boolean DEFAULT false, discount numeric DEFAULT 0, voucher_amount numeric DEFAULT 0,
 phone_suffix8 text, created_at timestamptz DEFAULT now()
);
CREATE TABLE shipment_simulations (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, sale_id uuid UNIQUE,
 tracking_code text, kind text, fulfillment text, stage text, stage_started_at timestamptz,
 customer_name text,customer_phone text, order_reference text,destination_city text,destination_state text,
 posted_at timestamptz,status text, merged_into_id uuid, real_tracking_code text,real_carrier text,
 delivered_at timestamptz,delivered_source text,delivery_estimate jsonb,stage_history jsonb DEFAULT '{}',
 created_at timestamptz DEFAULT now(),
 CONSTRAINT shipment_simulations_delivered_source_chk CHECK(delivered_source IN ('carrier','customer_informed','manual'))
);
CREATE TABLE exchange_requests (delivered_source text CONSTRAINT exchange_requests_delivered_source_check CHECK(delivered_source IN ('carrier','customer_informed','manual')));
CREATE TABLE trocas_devolucoes (pedido_novo_id uuid,diferenca_venda_id uuid,pedido_original_id uuid,valor_devolvido numeric);
CREATE TABLE whatsapp_messages (id uuid DEFAULT gen_random_uuid(),phone text,message text,created_at timestamptz DEFAULT now(),direction text DEFAULT 'incoming',is_group boolean DEFAULT false,channel text,source text,media_type text,whatsapp_number_id uuid);
CREATE TABLE whatsapp_messages_archive (LIKE whatsapp_messages);
CREATE TABLE support_settings (exchange_window_days int,return_window_days int);
INSERT INTO support_settings VALUES(7,7);
CREATE TABLE orders (id uuid,shopify_order_id text,shopify_order_name text);
CREATE TABLE expedition_orders (shopify_order_id text,shopify_order_number text,shopify_order_name text,freight_tracking_code text,created_at timestamptz);
CREATE FUNCTION gen_shipment_public_code() RETURNS text LANGUAGE sql AS $$ SELECT 'BC-'||gen_random_uuid()::text $$;
CREATE TABLE test_support_enqueues (message_id uuid);
CREATE FUNCTION support_ai_enqueue(uuid,text,uuid,text,text) RETURNS void LANGUAGE sql AS $$ INSERT INTO test_support_enqueues VALUES($1) $$;
\ir fixtures/storePickupFunctions.sql
CREATE TRIGGER trg_ensure_shipment_tracking AFTER INSERT OR UPDATE OF status ON pos_sales FOR EACH ROW EXECUTE FUNCTION ensure_shipment_tracking_for_sale();
CREATE TRIGGER trg_support_auto_detect AFTER INSERT ON whatsapp_messages FOR EACH ROW WHEN(NEW.direction='incoming' AND NEW.is_group IS NOT TRUE AND NEW.message IS NOT NULL AND NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION support_auto_detect_trigger();
\ir ../../drizzle/migrations/0283_store_pickup_delivery_guards.sql
\ir ../../drizzle/migrations/0284_store_pickup_delivery_integration.sql
\ir ../../drizzle/migrations/0286_pickup_single_incoming_validation.sql
-- Count calls in this disposable database only, without changing production functions.
CREATE TABLE test_pickup_invalidations (called boolean);
ALTER FUNCTION invalidate_pickup_on_shipping_question(text,timestamptz) RENAME TO test_invalidate_pickup_actual;
CREATE FUNCTION invalidate_pickup_on_shipping_question(text,timestamptz) RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO test_pickup_invalidations VALUES(true); PERFORM test_invalidate_pickup_actual($1,$2); END $$;

CREATE FUNCTION test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;

INSERT INTO pos_sales(id,customer_phone,phone_suffix8,customer_city,customer_state,customer_cep,tracking_carrier,expedition_stage,expedition_finished_at)
VALUES('00000000-0000-0000-0000-000000000001','5533999990001','99990001','Governador Valadares','MG','35000000','Retirada na loja','embalado',NULL);
SELECT test_assert((SELECT delivered_at IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000001'),'not delivered before expedition completion');
UPDATE pos_sales SET expedition_stage='concluido',expedition_finished_at=now()-interval '6 days' WHERE id='00000000-0000-0000-0000-000000000001';
SELECT test_assert((SELECT s.delivered_at=p.expedition_finished_at AND s.delivered_source='retirada' AND s.stage='entregue' AND s.status='delivered' FROM shipment_simulations s JOIN pos_sales p ON p.id=s.sale_id WHERE p.id='00000000-0000-0000-0000-000000000001'),'completion creates pickup delivery with exact expedition date');
SELECT test_assert(check_exchange_eligibility('00000000-0000-0000-0000-000000000001','troca')->>'eligible'='eligible','pickup accepted for exchange');
SELECT test_assert(check_exchange_eligibility('00000000-0000-0000-0000-000000000001','devolucao')->>'delivered_source'='retirada','pickup source preserved for return');
SELECT test_assert((check_exchange_eligibility('00000000-0000-0000-0000-000000000001','troca')->>'deadline_at')::timestamptz=(SELECT expedition_finished_at+interval '7 days' FROM pos_sales WHERE id='00000000-0000-0000-0000-000000000001'),'exact delivery plus 7 calendar days');
SELECT test_assert('2026-11-27 12:00:00-03'::timestamptz+interval '7 days'='2026-12-04 12:00:00-03'::timestamptz,'Saturday Sunday and holiday are not skipped');
UPDATE pos_sales SET expedition_finished_at=now()-interval '7 days 1 second' WHERE id='00000000-0000-0000-0000-000000000001';
SELECT test_assert(check_exchange_eligibility('00000000-0000-0000-0000-000000000001','troca')->>'eligible'='needs_human','expired pickup deadline stays human');
UPDATE pos_sales SET expedition_finished_at=now()-interval '1 day' WHERE id='00000000-0000-0000-0000-000000000001';
INSERT INTO whatsapp_messages(phone,message) VALUES('5533999990001','Oii já preenchi meu cadastro #AB123. Pode enviar o link do meu carrinho?');
SELECT test_assert((SELECT delivered_source='retirada' FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000001'),'registration message never invalidates delivery');
INSERT INTO whatsapp_messages(phone,message) VALUES('33999990001','Vocês já vão enviar meu pedido?');
SELECT test_assert((SELECT delivered_at IS NULL AND delivered_source IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000001'),'later shipping question clears pickup delivery');
SELECT test_assert(check_exchange_eligibility('00000000-0000-0000-0000-000000000001','troca')->>'eligible'='needs_human','shipping question blocks exchange');
SELECT test_assert(central_ship_guarantee('00000000-0000-0000-0000-000000000001') IS NULL,'shipping guarantee cannot bypass pickup guard');
SELECT test_assert((SELECT count(*)=2 FROM test_support_enqueues),'existing support enqueue preserved; no actual messages sent');
SELECT test_assert((SELECT count(*)=1 FROM test_pickup_invalidations),'only one indexed invalidation per shipping question');

INSERT INTO pos_sales(id,customer_phone,phone_suffix8,customer_city,customer_state,customer_cep,tracking_carrier,expedition_stage,expedition_finished_at)
VALUES('00000000-0000-0000-0000-000000000002','5512999990002','99990002','São Sebastião','SP','11619353','Retirada na loja','concluido',now()-interval '1 day');
SELECT test_assert((SELECT delivered_at IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000002'),'Eloa outside MG never receives pickup delivery');
UPDATE pos_sales SET customer_city='Belo Horizonte',customer_state='MG',customer_cep='30535630' WHERE id='00000000-0000-0000-0000-000000000002';
SELECT test_assert((SELECT delivered_at IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000002'),'distant MG municipality blocked');
UPDATE pos_sales SET customer_city='Caratinga',customer_cep='35300327' WHERE id='00000000-0000-0000-0000-000000000002';
SELECT test_assert((SELECT delivered_source='retirada' FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000002'),'municipality within 150km accepted');
UPDATE pos_sales SET shipping_address='{"state":"SP"}' WHERE id='00000000-0000-0000-0000-000000000002';
SELECT test_assert((SELECT delivered_at IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000002'),'conflicting address state blocked');
UPDATE pos_sales SET shipping_address=NULL,customer_cep='11619353' WHERE id='00000000-0000-0000-0000-000000000002';
SELECT test_assert((SELECT delivered_at IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000002'),'outside MG postcode overrides nearby city');
UPDATE pos_sales SET customer_cep='35300327',sale_type='exchange' WHERE id='00000000-0000-0000-0000-000000000002';
SELECT test_assert((SELECT delivered_at IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000002'),'exchange credit sale blocked');
UPDATE pos_sales SET sale_type='live',voucher_amount=100 WHERE id='00000000-0000-0000-0000-000000000002';
SELECT test_assert((SELECT delivered_at IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000002'),'voucher credit blocked');
UPDATE pos_sales SET voucher_amount=0 WHERE id='00000000-0000-0000-0000-000000000002';
INSERT INTO trocas_devolucoes(pedido_novo_id) VALUES('00000000-0000-0000-0000-000000000002');
SELECT sync_pickup_delivery('00000000-0000-0000-0000-000000000002');
SELECT test_assert((SELECT delivered_at IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000002'),'linked replacement sale blocked');
UPDATE shipment_simulations SET delivered_source='carrier',delivered_at=now()-interval '1 hour',stage='entregue' WHERE sale_id='00000000-0000-0000-0000-000000000002';
SELECT sync_pickup_delivery('00000000-0000-0000-0000-000000000002');
INSERT INTO whatsapp_messages(phone,message) VALUES('5512999990002','Cadê meu pedido?');
SELECT test_assert((SELECT delivered_source='carrier' AND delivered_at IS NOT NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000002'),'carrier evidence preserved even after a new shipping question');

INSERT INTO pos_sales(id,customer_phone,phone_suffix8,customer_city,customer_state,customer_cep,shipping_carrier,expedition_stage,shipped_at,shipped_source)
VALUES('00000000-0000-0000-0000-000000000003','5533999990003','99990003','Governador Valadares','MG','35000000','Retirada na loja','concluido',now()-interval '1 day','expedicao');
SELECT test_assert((SELECT s.delivered_at=p.shipped_at FROM shipment_simulations s JOIN pos_sales p ON p.id=s.sale_id WHERE p.id='00000000-0000-0000-0000-000000000003'),'expedition shipped date used when finished date absent');
UPDATE pos_sales SET shipped_source='transportadora' WHERE id='00000000-0000-0000-0000-000000000003';
SELECT test_assert((SELECT delivered_at IS NULL FROM shipment_simulations WHERE sale_id='00000000-0000-0000-0000-000000000003'),'carrier shipped date not treated as store pickup');
SELECT test_assert(NOT has_function_privilege('anon','pickup_delivery_guard(pos_sales)','EXECUTE'),'no anonymous guard access');
SELECT test_assert(NOT has_function_privilege('authenticated','sync_pickup_delivery(uuid)','EXECUTE'),'no direct client delivery write');