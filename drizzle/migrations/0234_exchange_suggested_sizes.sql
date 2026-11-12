ALTER TABLE public.exchange_requests ADD COLUMN IF NOT EXISTS suggested_size text;
COMMENT ON COLUMN public.exchange_requests.suggested_size IS 'Sugestão determinística para a equipe de Expedição; não reserva nem obriga a escolha da cliente.';

CREATE OR REPLACE FUNCTION public.exchange_suggested_size(p_size text, p_reason text, p_verbatim text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v_text text; v_size numeric; v_direction integer;
BEGIN
  IF p_size IS NULL OR trim(p_size) !~ '^[0-9]+([.,][0-9]+)?$' THEN RETURN NULL; END IF;
  v_text:=lower(unaccent(coalesce(p_reason,'')||' '||coalesce(p_verbatim,'')));
  v_direction:=CASE
    WHEN v_text ~ '(^|[^a-z])(apertad|pequen|curto|justo)' THEN 1
    WHEN v_text ~ '(^|[^a-z])(grande|folgad|largo|sobrando)' THEN -1
    ELSE 0 END;
  IF v_direction=0 THEN RETURN NULL; END IF;
  v_size:=replace(trim(p_size),',','.')::numeric+v_direction;
  IF v_size<=0 THEN RETURN NULL; END IF;
  RETURN v_size::text;
END $$;
REVOKE ALL ON FUNCTION public.exchange_suggested_size(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exchange_suggested_size(text,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.exchange_fill_suggested_size()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.suggested_size IS NULL THEN
    NEW.suggested_size:=public.exchange_suggested_size(NEW.product_size,NEW.reason_category::text,NEW.customer_verbatim);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS exchange_fill_suggested_size_trigger ON public.exchange_requests;
CREATE TRIGGER exchange_fill_suggested_size_trigger
BEFORE INSERT OR UPDATE OF product_size,reason_category,customer_verbatim,suggested_size ON public.exchange_requests
FOR EACH ROW EXECUTE FUNCTION public.exchange_fill_suggested_size();

CREATE OR REPLACE FUNCTION public.exchange_desk_list(p_tab text, p_type text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d text := regexp_replace(coalesce(p_search,''),'\D','','g'); s text := trim(coalesce(p_search,'')); r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(s) > 100 OR p_offset < 0 OR p_offset > 10000 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO r FROM (
    SELECT e.id, e.request_type, split_part(coalesce(e.customer_name,''),' ',1) AS first_name, e.customer_name, e.phone, e.whatsapp_number_id, e.order_ref, e.order_number,
      e.product_name, e.product_size, e.desired_size, e.suggested_size, e.requested_quantity, e.reason_category::text AS reason, e.status::text AS status,
      e.escalated_reason, e.created_at, e.assigned_to, e.reverse_shipping_code, e.trocas_devolucoes_id, e.is_test
    FROM exchange_requests e
    WHERE CASE p_tab
        WHEN 'precisa' THEN e.status = 'escalado' OR (e.status = 'aprovado' AND e.reverse_shipping_code IS NULL)
        WHEN 'andamento' THEN e.status IN ('solicitado','aguardando_postagem','em_transito','recebido') OR (e.status = 'aprovado' AND e.reverse_shipping_code IS NOT NULL)
        WHEN 'concluidas' THEN e.status IN ('concluido','recusado','cancelado')
        ELSE false END
      AND (p_type IS NULL OR e.request_type = p_type)
      AND (p_reason IS NULL OR e.reason_category::text = p_reason)
      AND (p_assignee IS NULL OR e.assigned_to = p_assignee)
      AND (s = '' OR e.customer_name ILIKE '%'||s||'%' OR e.order_ref ILIKE '%'||s||'%' OR e.order_number ILIKE '%'||s||'%'
           OR (length(d) >= 4 AND regexp_replace(e.phone,'\D','','g') LIKE '%'||d||'%'))
    ORDER BY e.created_at, e.id
    LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET p_offset) x;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_list(text,text,text,uuid,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_list(text,text,text,uuid,text,integer,integer) TO authenticated,service_role;