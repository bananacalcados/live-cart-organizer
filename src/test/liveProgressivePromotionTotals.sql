-- Teste transacional: nenhuma live, promoção ou pedido permanece no banco.
BEGIN;

DO $test$
DECLARE
  v_event uuid := gen_random_uuid();
  v_promotion uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  INSERT INTO public.events (id, name) VALUES (v_event, 'TESTE promoção progressiva — rollback');
  INSERT INTO public.event_promotions (
    id, event_id, name, shopify_product_ids, tiers, is_active, free_shipping, blocks_cashback
  ) VALUES (
    v_promotion, v_event, '3 por 200', ARRAY['999999999999'],
    '[{"qty":1,"price":99.99},{"qty":2,"price":159.99},{"qty":3,"price":199.99}]'::jsonb,
    true, true, true
  );

  v_result := public.compute_live_order_conditions(
    v_event, 'teste_inexistente', null,
    '[{"shopify_product_id":"999999999999","quantity":1,"price":199.99}]'::jsonb
  );
  IF (v_result->>'subtotal')::numeric <> 99.99 THEN
    RAISE EXCEPTION '1 unidade deveria totalizar 99.99; resultado: %', v_result;
  END IF;

  v_result := public.compute_live_order_conditions(
    v_event, 'teste_inexistente', null,
    '[{"shopify_product_id":"999999999999","quantity":2,"price":199.99}]'::jsonb
  );
  IF (v_result->>'subtotal')::numeric <> 159.99 THEN
    RAISE EXCEPTION '2 unidades deveriam totalizar 159.99; resultado: %', v_result;
  END IF;

  v_result := public.compute_live_order_conditions(
    v_event, 'teste_inexistente', null,
    '[{"shopify_product_id":"999999999999","quantity":3,"price":199.99}]'::jsonb
  );
  IF (v_result->>'subtotal')::numeric <> 199.99 THEN
    RAISE EXCEPTION '3 unidades deveriam totalizar 199.99; resultado: %', v_result;
  END IF;

  -- Duas linhas/cores diferentes continuam formando um único grupo de três.
  v_result := public.compute_live_order_conditions(
    v_event, 'teste_inexistente', null,
    '[
      {"shopify_product_id":"999999999999","shopify_variant_id":"cor-a","quantity":1,"price":199.99},
      {"shopify_product_id":"999999999999","shopify_variant_id":"cor-b","quantity":2,"price":199.99}
    ]'::jsonb
  );
  IF (v_result->>'subtotal')::numeric <> 199.99 THEN
    RAISE EXCEPTION 'Grupo misto deveria totalizar 199.99; resultado: %', v_result;
  END IF;

  -- A promoção vinculada no painel vale mesmo sem o produto na lista geral da promoção.
  UPDATE public.event_promotions SET shopify_product_ids = '{}'
  WHERE id = v_promotion;
  INSERT INTO public.live_presenter_products (event_id, code, promotion_id)
  VALUES (v_event, 'B060', v_promotion);
  v_result := public.compute_live_order_conditions(
    v_event, 'teste_inexistente', null,
    '[{"shopify_product_id":"10404493885497","shopify_variant_id":"50981828198457","quantity":3,"price":199.99}]'::jsonb
  );
  IF v_result->'items'->0->>'promotion_id' <> v_promotion::text
    OR (v_result->>'subtotal')::numeric <> 199.99 THEN
    RAISE EXCEPTION 'Promoção escolhida no painel não foi aplicada: %', v_result;
  END IF;
END $test$;

ROLLBACK;
