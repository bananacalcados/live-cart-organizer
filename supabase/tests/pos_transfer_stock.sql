-- Testes do motor de transferência (pos_transfer_stock / pos_reverse_stock_transfer).
-- Roda tudo dentro de um bloco que termina com RAISE EXCEPTION: nada fica gravado
-- (só a sequência do número T- avança). A mensagem final traz o resultado de cada teste.
DO $$
DECLARE
  c_from uuid := '1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2'; -- Loja Perola
  c_to   uuid := '4ade7b44-5043-4ab1-a124-7a6ab5468e29'; -- Loja Centro
  v_admin uuid;
  a uuid; b uuid; c uuid; d uuid; d_dst uuid; x uuid;
  res jsonb; res2 jsonb; rev jsonb;
  out text[] := '{}';
  n int; n2 int; ok boolean; s numeric; act boolean;
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin' LIMIT 1;

  INSERT INTO public.pos_products (store_id, sku, name, barcode, stock, size, color, parent_sku)
  VALUES (c_from, 'TSTTRF-A', 'TESTE TRF A', 'TSTTRF0001', 5, '35', 'Preto', 'TSTTRF-PA') RETURNING id INTO a;
  INSERT INTO public.pos_products (store_id, sku, name, barcode, stock, size, color, parent_sku)
  VALUES (c_from, 'TSTTRF-B', 'TESTE TRF B', 'TSTTRF0002', 5, '36', 'Preto', 'TSTTRF-PB') RETURNING id INTO b;
  INSERT INTO public.pos_products (store_id, sku, name, barcode, stock, size, color, parent_sku)
  VALUES (c_from, 'TSTTRF-C', 'TESTE TRF C', 'TSTTRF0003', 2, '37', 'Preto', 'TSTTRF-PC') RETURNING id INTO c;
  INSERT INTO public.pos_products (store_id, sku, name, barcode, stock, size, color, parent_sku)
  VALUES (c_from, 'TSTTRF-D', 'TESTE TRF D', 'TSTTRF0004', 3, '38', 'Preto', 'TSTTRF-PD') RETURNING id INTO d;
  INSERT INTO public.pos_products (store_id, sku, name, barcode, stock, size, color, parent_sku, is_active)
  VALUES (c_to, 'TSTTRF-D', 'TESTE TRF D', 'TSTTRF0004', 0, '38', 'Preto', 'TSTTRF-PD', false) RETURNING id INTO d_dst;

  -- 1) saldo insuficiente em 1 de 3 itens: nada muda
  BEGIN
    PERFORM public.pos_transfer_stock(c_from, c_to, jsonb_build_array(
      jsonb_build_object('pos_product_id', a, 'quantity', 1),
      jsonb_build_object('pos_product_id', b, 'quantity', 1),
      jsonb_build_object('pos_product_id', c, 'quantity', 10)), null, v_admin, 'Teste', 'tst-1', false);
    out := out || 'FALHOU 1 saldo insuficiente (não deu erro)'::text;
  EXCEPTION WHEN others THEN
    SELECT count(*) INTO n FROM public.pos_stock_adjustments WHERE product_id IN (a,b,c);
    SELECT count(*) INTO n2 FROM public.pos_stock_transfers WHERE idempotency_key = 'tst-1';
    ok := (SELECT stock FROM public.pos_products WHERE id=a) = 5 AND (SELECT stock FROM public.pos_products WHERE id=b) = 5
      AND (SELECT stock FROM public.pos_products WHERE id=c) = 2 AND n = 0 AND n2 = 0;
    out := out || (CASE WHEN ok THEN 'OK' ELSE 'FALHOU' END || ' 1 saldo insuficiente em 1 de 3 → nada muda [' || SQLERRM || ']');
  END;

  -- 2) dry_run não grava
  SELECT count(*) INTO n FROM public.pos_stock_transfers;
  res := public.pos_transfer_stock(c_from, c_to, jsonb_build_array(jsonb_build_object('pos_product_id', a, 'quantity', 2)), null, v_admin, 'Teste', 'tst-dry', true);
  SELECT count(*) INTO n2 FROM public.pos_stock_transfers;
  ok := (res->>'ok')::boolean AND n = n2 AND (SELECT stock FROM public.pos_products WHERE id=a) = 5
    AND NOT EXISTS (SELECT 1 FROM public.pos_stock_adjustments WHERE product_id = a)
    AND NOT EXISTS (SELECT 1 FROM public.pos_products WHERE store_id=c_to AND barcode='TSTTRF0001')
    AND (res->'items'->0->>'destino_sera_criado')::boolean;
  out := out || (CASE WHEN ok THEN 'OK' ELSE 'FALHOU' END || ' 2 dry_run não grava');

  -- 3) destino inexistente → linha criada
  res := public.pos_transfer_stock(c_from, c_to, jsonb_build_array(
    jsonb_build_object('pos_product_id', a, 'quantity', 1),
    jsonb_build_object('pos_product_id', a, 'quantity', 1)), 'teste', v_admin, 'Teste', 'tst-3', false);
  SELECT id, stock INTO x, s FROM public.pos_products WHERE store_id=c_to AND barcode='TSTTRF0001';
  ok := x IS NOT NULL AND s = 2 AND (SELECT stock FROM public.pos_products WHERE id=a) = 3
    AND jsonb_array_length(res->'items') = 1 AND (res->>'total_items')::int = 2;
  out := out || (CASE WHEN ok THEN 'OK' ELSE 'FALHOU' END || ' 3 destino inexistente → criado (itens repetidos agrupados) ' || (res->>'label'));

  -- 4) destino inativo → reativado (sem criar outra linha)
  res2 := public.pos_transfer_stock(c_from, c_to, jsonb_build_array(jsonb_build_object('pos_product_id', d, 'quantity', 1)), null, v_admin, 'Teste', 'tst-4', false);
  SELECT stock, is_active INTO s, act FROM public.pos_products WHERE id = d_dst;
  SELECT count(*) INTO n FROM public.pos_products WHERE store_id=c_to AND barcode='TSTTRF0004';
  ok := s = 1 AND act AND n = 1;
  out := out || (CASE WHEN ok THEN 'OK' ELSE 'FALHOU' END || ' 4 destino inativo → reativado');

  -- 5) exatamente 2 linhas de histórico por item, sem blindagem
  SELECT count(*) INTO n FROM public.pos_stock_adjustments WHERE product_id IN (a, x, d, d_dst) AND movement_type='transferencia';
  SELECT count(*) INTO n2 FROM public.pos_stock_adjustments WHERE product_id IN (a, x, d, d_dst) AND reason ILIKE '%blindagem%';
  ok := n = 4 AND n2 = 0;
  out := out || (CASE WHEN ok THEN 'OK' ELSE 'FALHOU' END || format(' 5 histórico: %s linhas de transferência para 2 itens, %s de blindagem', n, n2));

  -- 6) idempotência
  res2 := public.pos_transfer_stock(c_from, c_to, jsonb_build_array(jsonb_build_object('pos_product_id', a, 'quantity', 2)), null, v_admin, 'Teste', 'tst-3', false);
  ok := (res2->>'duplicate')::boolean AND res2->>'id' = res->>'id' AND (SELECT stock FROM public.pos_products WHERE id=a) = 3
    AND (SELECT stock FROM public.pos_products WHERE id=x) = 2;
  out := out || (CASE WHEN ok THEN 'OK' ELSE 'FALHOU' END || ' 6 mesma chave devolve a mesma transferência sem repetir');

  -- 7) estorno: não-admin bloqueado; admin devolve o saldo e liga as duas
  BEGIN
    PERFORM public.pos_reverse_stock_transfer((res->>'id')::uuid, gen_random_uuid(), 'Intruso', 'teste');
    out := out || 'FALHOU 7a não-admin conseguiu estornar'::text;
  EXCEPTION WHEN others THEN out := out || ('OK 7a não-admin bloqueado [' || SQLERRM || ']'); END;
  rev := public.pos_reverse_stock_transfer((res->>'id')::uuid, v_admin, 'Teste', 'teste de estorno');
  ok := (SELECT stock FROM public.pos_products WHERE id=a) = 5 AND (SELECT stock FROM public.pos_products WHERE id=x) = 0
    AND (SELECT status FROM public.pos_stock_transfers WHERE id=(res->>'id')::uuid) = 'estornada'
    AND (SELECT reversed_by_transfer FROM public.pos_stock_transfers WHERE id=(res->>'id')::uuid) = (rev->>'id')::uuid
    AND (SELECT reversed_of FROM public.pos_stock_transfers WHERE id=(rev->>'id')::uuid) = (res->>'id')::uuid;
  out := out || (CASE WHEN ok THEN 'OK' ELSE 'FALHOU' END || ' 7b estorno devolve saldo e liga as duas');
  BEGIN
    PERFORM public.pos_reverse_stock_transfer((res->>'id')::uuid, v_admin, 'Teste', 'de novo');
    out := out || 'FALHOU 7c estornou duas vezes'::text;
  EXCEPTION WHEN others THEN out := out || 'OK 7c não estorna duas vezes'::text; END;

  RAISE EXCEPTION 'RESULTADO_TESTES (tudo desfeito): %', array_to_string(out, E'\n');
END $$;
