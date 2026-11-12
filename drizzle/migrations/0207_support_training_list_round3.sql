CREATE OR REPLACE FUNCTION public.support_training_list(p_run uuid, p_group text DEFAULT 'suporte'::text, p_pending_only boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS SETOF public.support_training_items LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.support_training_items
    WHERE run_id = p_run AND review_group = p_group AND (NOT coalesce(p_pending_only,false) OR CASE WHEN replay3_result IS NOT NULL THEN replay3_result->'review'->>'at' IS NULL WHEN replay_result IS NOT NULL THEN replay_result->'review'->>'at' IS NULL ELSE reviewed_at IS NULL END)
    ORDER BY last_incoming_at DESC, id LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET greatest(coalesce(p_offset,0),0);
END $function$;