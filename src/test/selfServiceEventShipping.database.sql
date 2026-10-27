BEGIN;
DO $$
DECLARE
  ev jsonb := '{"operation_mode":"whatsapp_autoatendimento","default_shipping_cost":19.99,"free_shipping_threshold":299.98}';
  o jsonb := '{"products":[{"price":139.99,"quantity":1}],"free_shipping":false,"shipping_cost":0}';
  r jsonb;
BEGIN
  r:=public.resolve_selfservice_event_shipping(o,ev);
  IF r IS DISTINCT FROM '{"shipping_cost":19.99,"free_shipping":false}'::jsonb THEN RAISE EXCEPTION '139.99 must charge 19.99'; END IF;
  r:=public.resolve_selfservice_event_shipping(o||'{"products":[{"price":299.98,"quantity":1}]}',ev);
  IF r->>'shipping_cost' IS DISTINCT FROM '19.99' THEN RAISE EXCEPTION '299.98 still charges freight'; END IF;
  r:=public.resolve_selfservice_event_shipping(o||'{"products":[{"price":299.99,"quantity":1}]}',ev);
  IF r IS DISTINCT FROM '{"shipping_cost":0,"free_shipping":true}'::jsonb THEN RAISE EXCEPTION '299.99 has free freight'; END IF;
  IF public.resolve_selfservice_event_shipping(o||'{"free_shipping":true}',ev) IS NOT NULL THEN RAISE EXCEPTION 'Manual exemption overwritten'; END IF;
  IF public.resolve_selfservice_event_shipping(o||'{"shipping_cost":12.5}',ev) IS NOT NULL THEN RAISE EXCEPTION 'Manual freight overwritten'; END IF;
  IF public.resolve_selfservice_event_shipping(o||'{"custom_shipping_cost":0}',ev) IS NOT NULL THEN RAISE EXCEPTION 'Manual zero overwritten'; END IF;
  IF public.resolve_selfservice_event_shipping(o||'{"is_pickup":true}',ev) IS NOT NULL THEN RAISE EXCEPTION 'Pickup overwritten'; END IF;
  IF public.resolve_selfservice_event_shipping(o||'{"is_paid":true}',ev) IS NOT NULL THEN RAISE EXCEPTION 'Paid order changed'; END IF;
  IF public.resolve_selfservice_event_shipping(o||'{"mercadopago_payment_id":"pending"}',ev) IS NOT NULL THEN RAISE EXCEPTION 'Provider attempt changed'; END IF;
  IF public.resolve_selfservice_event_shipping(o,ev||'{"operation_mode":"whatsapp"}') IS NOT NULL THEN RAISE EXCEPTION 'Manual live changed'; END IF;
  r:=public.resolve_selfservice_event_shipping(o||'{"products":[{"price":350,"quantity":1}],"discount_type":"fixed","discount_value":60}',ev);
  IF r->>'shipping_cost' IS DISTINCT FROM '19.99' THEN RAISE EXCEPTION 'Discount threshold not applied'; END IF;
  r:=public.resolve_selfservice_event_shipping(o||'{"free_shipping":true,"shipping_info":{"source":"event_rule","price":0}}',ev);
  IF r->>'shipping_cost' IS DISTINCT FROM '19.99' THEN RAISE EXCEPTION 'Automatic exemption not recalculated'; END IF;
END $$;
ROLLBACK;