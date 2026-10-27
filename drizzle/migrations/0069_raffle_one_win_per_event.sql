CREATE OR REPLACE FUNCTION public.event_raffle_pool(p_raffle_id uuid)
 RETURNS TABLE(phone text, display_name text, order_id uuid, product text, entry_value numeric, registration_minutes numeric, payment_minutes numeric, eligible boolean, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.event_raffles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.event_raffles WHERE id = p_raffle_id;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT o.id, o.created_at, o.stage,
      (coalesce(o.is_paid,false) OR coalesce(o.paid_externally,false)) AS paid,
      public.raffle_norm_phone(c.whatsapp) AS ph, c.instagram_handle AS handle,
      coalesce(o.products->0->>'title', o.products->0->>'name') AS prod,
      (SELECT coalesce(sum(coalesce(nullif(x->>'price','')::numeric,0) * coalesce(nullif(x->>'quantity','')::numeric,1)),0)
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.products) = 'array' THEN o.products ELSE '[]'::jsonb END) x) AS val,
      round((extract(epoch FROM (o.registered_at - o.created_at)) / 60.0)::numeric, 1) AS reg_min,
      round((extract(epoch FROM (o.paid_at - o.created_at)) / 60.0)::numeric, 1) AS pay_min
    FROM public.orders o LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE o.event_id = r.event_id AND o.stage <> 'cancelled'
  ), q AS (
    SELECT b.*, right(b.ph, 8) AS k,
      CASE WHEN r.audience = 'confirmed_orders' THEN b.stage NOT IN ('pre_sale','incomplete_order','awaiting_confirmation')
           WHEN r.audience = 'payers' THEN b.paid ELSE false END AS in_aud,
      (r.max_registration_minutes IS NULL OR (b.reg_min IS NOT NULL AND b.reg_min <= r.max_registration_minutes)) AS reg_ok,
      (r.max_payment_minutes IS NULL OR (b.paid AND b.pay_min IS NOT NULL AND b.pay_min <= r.max_payment_minutes)) AS pay_ok
    FROM base b WHERE b.ph IS NOT NULL
  ), agg AS (
    SELECT q.k, coalesce(sum(q.val) FILTER (WHERE q.in_aud), 0) AS aud_val FROM q GROUP BY q.k
  ), best AS (
    SELECT DISTINCT ON (q.k) q.* FROM q ORDER BY q.k, q.in_aud DESC, (q.in_aud AND q.reg_ok AND q.pay_ok) DESC, q.created_at
  ), winners AS (
    SELECT DISTINCT right(regexp_replace(w.phone,'\D','','g'), 8) AS k
      FROM public.event_raffle_winners w JOIN public.event_raffles r2 ON r2.id = w.raffle_id
     WHERE r2.event_id = r.event_id AND r2.id <> r.id AND w.voided_at IS NULL
  ), from_orders AS (
    SELECT b.ph, b.handle::text, b.id, b.prod, a.aud_val, b.reg_min, b.pay_min,
      CASE
        WHEN NOT b.in_aud THEN 'fora do público'
        WHEN coalesce(r.prize_requires_paid,false) AND NOT b.paid THEN 'não pagou'
        WHEN NOT b.reg_ok THEN CASE WHEN b.reg_min IS NULL THEN 'cadastro não concluído' ELSE 'cadastro em ' || trim_scale(b.reg_min) || ' min' END
        WHEN NOT b.pay_ok THEN CASE WHEN NOT b.paid THEN 'não pagou' WHEN b.pay_min IS NULL THEN 'pagamento sem horário' ELSE 'pagamento em ' || trim_scale(b.pay_min) || ' min' END
        WHEN coalesce(r.min_purchase_value,0) > 0 AND a.aud_val < r.min_purchase_value THEN 'abaixo do valor mínimo'
        WHEN EXISTS (SELECT 1 FROM winners w WHERE w.k = b.k) THEN 'já ganhou outro sorteio'
      END AS why
    FROM best b JOIN agg a ON a.k = b.k
  ), from_leads AS (
    SELECT DISTINCT ON (right(public.raffle_norm_phone(l.phone), 8))
      public.raffle_norm_phone(l.phone) AS ph, coalesce(l.instagram, l.name)::text AS handle,
      CASE WHEN coalesce(r.prize_requires_paid,false) THEN 'sem pedido pago' WHEN EXISTS (SELECT 1 FROM winners w WHERE w.k = right(public.raffle_norm_phone(l.phone), 8)) THEN 'já ganhou outro sorteio' END AS why
    FROM public.event_leads l
    WHERE r.audience = 'live_leads' AND l.event_id = r.event_id AND NOT coalesce(l.disqualified, false)
      AND public.raffle_norm_phone(l.phone) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM q WHERE q.k = right(public.raffle_norm_phone(l.phone), 8))
    ORDER BY right(public.raffle_norm_phone(l.phone), 8), l.created_at
  )
  SELECT f.ph, f.handle, f.id, f.prod, f.aud_val, f.reg_min, f.pay_min, f.why IS NULL, f.why FROM from_orders f
  UNION ALL
  SELECT l.ph, l.handle, NULL::uuid, NULL::text, 0::numeric, NULL::numeric, NULL::numeric, l.why IS NULL, l.why FROM from_leads l;
END $function$;

-- Trava final: mesma pessoa (últimos 8 dígitos) não ganha dois sorteios do mesmo evento, mesmo com sorteios simultâneos.
CREATE OR REPLACE FUNCTION public.event_raffle_winner_unique_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event uuid; v_k text;
BEGIN
  SELECT event_id INTO v_event FROM public.event_raffles WHERE id = NEW.raffle_id;
  v_k := right(regexp_replace(coalesce(NEW.phone,''),'\D','','g'), 8);
  IF v_event IS NULL OR v_k = '' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('raffle_winner:' || v_event::text));
  IF EXISTS (
    SELECT 1 FROM public.event_raffle_winners w JOIN public.event_raffles r ON r.id = w.raffle_id
     WHERE r.event_id = v_event AND w.voided_at IS NULL
       AND right(regexp_replace(coalesce(w.phone,''),'\D','','g'), 8) = v_k
  ) THEN
    RAISE EXCEPTION 'raffle_winner_already_won' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_event_raffle_winner_unique ON public.event_raffle_winners;
CREATE TRIGGER trg_event_raffle_winner_unique BEFORE INSERT ON public.event_raffle_winners
FOR EACH ROW EXECUTE FUNCTION public.event_raffle_winner_unique_guard();

-- Cremilda: liga o prêmio da bolsa ao pedido dela (o pedido já tinha "Bolsa brinde" anotado à mão; texto preservado).
UPDATE public.customer_prizes
   SET applied_order_id = 'f29e34c4-3125-47fa-9156-3638f46831a5', fulfillment_status = 'reserved', reserved_at = now(), updated_at = now()
 WHERE id = '3acaaf95-f5cc-4b4a-b9c4-295e70d482bf' AND applied_order_id IS NULL;