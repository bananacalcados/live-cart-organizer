-- Isolated local database only; no gateway, HTTP extension or business triggers.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.events(id uuid PRIMARY KEY, operation_mode text);
CREATE TABLE public.customers(id uuid PRIMARY KEY, whatsapp text, instagram_handle text);
CREATE TABLE public.orders(id uuid PRIMARY KEY, event_id uuid, customer_id uuid, phone_last4 text, stage text, is_paid boolean, paid_externally boolean, merged_into_order_id uuid, products jsonb);
CREATE TABLE public.customer_registrations(order_id uuid PRIMARY KEY, whatsapp text);
CREATE TABLE public.live_selfservice_accesses(id uuid PRIMARY KEY, event_id uuid, instagram text, order_ids uuid[], whatsapp_confirmed_at timestamptz, registered_at timestamptz, confirmed_phone text, confirmed_phone_key text);
CREATE FUNCTION public.event_phone_key(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT right(regexp_replace($1,'\D','','g'),10) $$;
CREATE FUNCTION public.ig_handle_norm(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(lower(trim($1,'@ ')),'') $$;
\ir ../../drizzle/migrations/0270_selfservice_late_incomplete_identity.sql
DO $$
DECLARE ev uuid:=gen_random_uuid(); cust uuid:=gen_random_uuid(); ord uuid:=gen_random_uuid(); acc uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); other_order uuid:=gen_random_uuid(); other_access uuid:=gen_random_uuid();
BEGIN
 INSERT INTO events VALUES(ev,'whatsapp_autoatendimento');
 INSERT INTO customers VALUES(cust,'','cilarocha2701');
 INSERT INTO orders VALUES(ord,ev,cust,'4550','incomplete_order',false,false,NULL,'[{"title":"Produto teste","price":159.99}]');
 INSERT INTO live_selfservice_accesses VALUES(acc,ev,'Cila Rocha','{}',now(),now(),'5533999994550',event_phone_key('5533999994550'));
 IF selfservice_access_for_order(ord) IS DISTINCT FROM acc THEN RAISE EXCEPTION 'Cadastro anterior com @ errado não resolveu o incompleto único'; END IF;
 INSERT INTO customers VALUES(other,'5531988884550','outra_pessoa');
 INSERT INTO orders VALUES(other_order,ev,other,'4550','awaiting_payment',false,false,NULL,'[{"title":"Outro produto"}]');
 INSERT INTO live_selfservice_accesses VALUES(other_access,ev,'outra_pessoa',ARRAY[other_order],now(),now(),'5531988884550',event_phone_key('5531988884550'));
 IF selfservice_access_for_order(ord) IS DISTINCT FROM acc THEN RAISE EXCEPTION 'Pedido completo de outra pessoa competiu pelo final'; END IF;
 UPDATE customers SET whatsapp='' WHERE id=other;
 DELETE FROM live_selfservice_accesses WHERE id=other_access;
 IF selfservice_access_for_order(ord) IS NOT NULL THEN RAISE EXCEPTION 'Dois incompletos foram associados sem escolha'; END IF;
 INSERT INTO customer_registrations VALUES(other_order,'5531988884550');
 IF selfservice_access_for_order(ord) IS DISTINCT FROM acc THEN RAISE EXCEPTION 'Ficha com telefone completo competiu pelo final'; END IF;
 INSERT INTO customer_registrations VALUES(ord,'5531988884550');
 IF selfservice_access_for_order(ord) IS NOT NULL THEN RAISE EXCEPTION 'Ficha de outro telefone foi sobrescrita'; END IF;
 DELETE FROM customer_registrations WHERE order_id=ord;
 INSERT INTO live_selfservice_accesses VALUES(other_access,ev,'nome_errado','{}',now(),now(),'5511988884550',event_phone_key('5511988884550'));
 IF selfservice_access_for_order(ord) IS NOT NULL THEN RAISE EXCEPTION 'Dois cadastros verificados de telefones distintos com mesmo final foram associados'; END IF;
 DELETE FROM live_selfservice_accesses WHERE id=other_access;
 UPDATE live_selfservice_accesses SET order_ids=ARRAY[other_order] WHERE id=acc;
 IF selfservice_access_for_order(ord) IS NOT NULL THEN RAISE EXCEPTION 'Cadastro já vinculado a outra identidade foi reaproveitado pelo final'; END IF;
 UPDATE live_selfservice_accesses SET order_ids=ARRAY[ord],instagram='cilarocha2701' WHERE id=acc;
 IF selfservice_access_for_order(ord) IS DISTINCT FROM acc THEN RAISE EXCEPTION 'Escolha explícita do pedido não foi preservada'; END IF;
 RAISE NOTICE '8 cenários de cadastro anterior passaram sem serviços externos';
END $$;