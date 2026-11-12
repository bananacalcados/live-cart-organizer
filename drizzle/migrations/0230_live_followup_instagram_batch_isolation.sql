DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.live_followup_source_contexts(integer)'::regprocedure) INTO def;
  def := replace(
    def,
    'coalesce(ig.whatsapp_number_id,(public.instagram_reply_context(coalesce(a.instagram,c.instagram_handle),e.id,NULL)->>''number_id'')::uuid)',
    'ig.whatsapp_number_id'
  );
  IF position('instagram_reply_context' in def) > 0 THEN
    RAISE EXCEPTION 'Não foi possível remover o fallback do Instagram do lote de follow-up';
  END IF;
  EXECUTE def;

  SELECT pg_get_functiondef('public.live_followup_audit_contexts(uuid,integer,integer)'::regprocedure) INTO def;
  def := replace(
    def,
    'coalesce(ig.whatsapp_number_id,(public.instagram_reply_context(coalesce(a.instagram,c.instagram_handle),e.id,NULL)->>''number_id'')::uuid)',
    'ig.whatsapp_number_id'
  );
  IF position('instagram_reply_context' in def) > 0 THEN
    RAISE EXCEPTION 'Não foi possível remover o fallback do Instagram da auditoria de follow-up';
  END IF;
  EXECUTE def;
END $$;