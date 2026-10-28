CREATE OR REPLACE FUNCTION public.trg_group_responsible_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b text; j text;
BEGIN
  j := CASE WHEN TG_TABLE_NAME='group_admin_actions' THEN to_jsonb(NEW)->>'group_jid' ELSE to_jsonb(NEW)->>'group_zapi_id' END;
  b := split_part(split_part(coalesce(j,''),'@',1),'-',1);
  IF b <> '' AND EXISTS (SELECT 1 FROM whatsapp_group_responsible r WHERE r.group_jid_base=b AND r.pending_since IS NOT NULL) THEN
    PERFORM recompute_group_responsible(b);
  END IF;
  RETURN NULL;
END $$;