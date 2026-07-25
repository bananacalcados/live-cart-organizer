CREATE OR REPLACE FUNCTION public.delete_unsent_dispatch(p_dispatch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d record;
  v_sent int;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role)
       OR has_role(auth.uid(), 'manager'::app_role)
       OR has_module_access(auth.uid(), 'marketing'::text)
       OR has_module_access(auth.uid(), 'management'::text)) THEN
    RAISE EXCEPTION 'Sem permissão para apagar disparos';
  END IF;

  SELECT * INTO v_d FROM dispatch_history WHERE id = p_dispatch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Disparo não encontrado');
  END IF;

  IF v_d.status IN ('sending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Disparo em andamento não pode ser apagado');
  END IF;

  IF COALESCE(v_d.sent_count, 0) > 0 OR COALESCE(v_d.failed_count, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Disparo já teve envios e não pode ser apagado');
  END IF;

  SELECT count(*) INTO v_sent
  FROM dispatch_recipients
  WHERE dispatch_id = p_dispatch_id
    AND COALESCE(status, 'pending') NOT IN ('pending', 'cancelled', 'skipped');
  IF v_sent > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Disparo já teve envios e não pode ser apagado');
  END IF;

  DELETE FROM dispatch_recipients WHERE dispatch_id = p_dispatch_id;
  DELETE FROM dispatch_history WHERE id = p_dispatch_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_unsent_dispatch(uuid) TO authenticated;