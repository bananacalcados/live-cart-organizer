CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_wa_conv_groups ON public.whatsapp_conversations(phone) WHERE is_group;
CREATE INDEX IF NOT EXISTS idx_wa_conv_phone_trgm ON public.whatsapp_conversations USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wa_conv_sender_trgm ON public.whatsapp_conversations USING gin (sender_name gin_trgm_ops);

-- Cabeças de grupo considerando TODAS as instâncias
CREATE OR REPLACE FUNCTION public.get_group_conversation_heads()
RETURNS TABLE(phone text, last_message text, last_message_at timestamptz, last_direction text, sender_name text, whatsapp_number_id uuid, unread_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (c.phone) c.phone, c.last_message, c.last_message_at, c.last_direction, c.sender_name, c.whatsapp_number_id,
         sum(coalesce(c.unread_count,0)) OVER (PARTITION BY c.phone)
  FROM public.whatsapp_conversations c
  WHERE c.is_group
  ORDER BY c.phone, c.last_message_at DESC NULLS LAST
$$;
REVOKE ALL ON FUNCTION public.get_group_conversation_heads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_conversation_heads() TO authenticated, service_role;

-- Resumo do arquivo
CREATE TABLE IF NOT EXISTS public.whatsapp_archive_conversations (
  phone text NOT NULL,
  whatsapp_number_id uuid,
  last_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  has_incoming boolean NOT NULL DEFAULT false,
  sender_name text,
  last_message text
);
GRANT SELECT ON public.whatsapp_archive_conversations TO authenticated;
GRANT ALL ON public.whatsapp_archive_conversations TO service_role;
ALTER TABLE public.whatsapp_archive_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read archive summary" ON public.whatsapp_archive_conversations FOR SELECT TO authenticated USING (true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_arch_conv ON public.whatsapp_archive_conversations (phone, (coalesce(whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)));
CREATE INDEX IF NOT EXISTS idx_wa_arch_conv_phone_trgm ON public.whatsapp_archive_conversations USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wa_arch_conv_sender_trgm ON public.whatsapp_archive_conversations USING gin (sender_name gin_trgm_ops);

INSERT INTO public.whatsapp_archive_conversations (phone, whatsapp_number_id, last_message_at, message_count, has_incoming, sender_name, last_message)
SELECT phone, whatsapp_number_id, max(created_at), count(*)::int, bool_or(direction = 'incoming'),
       (array_agg(sender_name ORDER BY (direction='incoming' AND sender_name IS NOT NULL) DESC, created_at DESC))[1],
       (array_agg(message ORDER BY created_at DESC))[1]
FROM public.whatsapp_messages_archive
WHERE is_group IS NOT TRUE
GROUP BY phone, whatsapp_number_id
ON CONFLICT DO NOTHING;

-- Recalcula o resumo para os telefones recém-arquivados
CREATE OR REPLACE FUNCTION public.wa_archive_summary_refresh(p_phones text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_phones IS NULL OR array_length(p_phones,1) IS NULL THEN RETURN; END IF;
  INSERT INTO public.whatsapp_archive_conversations AS s (phone, whatsapp_number_id, last_message_at, message_count, has_incoming, sender_name, last_message)
  SELECT phone, whatsapp_number_id, max(created_at), count(*)::int, bool_or(direction = 'incoming'),
         (array_agg(sender_name ORDER BY (direction='incoming' AND sender_name IS NOT NULL) DESC, created_at DESC))[1],
         (array_agg(message ORDER BY created_at DESC))[1]
  FROM public.whatsapp_messages_archive
  WHERE phone = ANY(p_phones) AND is_group IS NOT TRUE
  GROUP BY phone, whatsapp_number_id
  ON CONFLICT (phone, (coalesce(whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET last_message_at = EXCLUDED.last_message_at, message_count = EXCLUDED.message_count,
    has_incoming = EXCLUDED.has_incoming, sender_name = coalesce(EXCLUDED.sender_name, s.sender_name), last_message = EXCLUDED.last_message;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_archive_summary_refresh: %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public.wa_archive_summary_refresh(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_archive_summary_refresh(text[]) TO service_role;

-- Rotinas de arquivamento: mesma lógica + atualização do resumo no mesmo passo
CREATE OR REPLACE FUNCTION public.archive_inactive_conversations(p_days integer DEFAULT 60, p_batch_size integer DEFAULT 10000)
 RETURNS TABLE(archived_phones integer, archived_messages integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff timestamptz := now() - (p_days || ' days')::interval;
  v_phones text[];
  v_msgs_count integer := 0;
BEGIN
  SELECT array_agg(phone) INTO v_phones
  FROM (SELECT phone FROM public.whatsapp_messages GROUP BY phone HAVING MAX(created_at) < v_cutoff LIMIT p_batch_size) sub
  WHERE phone NOT IN (
    SELECT DISTINCT regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g')
    FROM public.customers c JOIN public.orders o ON o.customer_id = c.id
    WHERE o.stage NOT IN ('delivered', 'cancelled', 'refunded') AND coalesce(whatsapp, '') <> '');
  IF v_phones IS NULL OR array_length(v_phones, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0; RETURN;
  END IF;
  WITH moved AS (
    DELETE FROM public.whatsapp_messages WHERE phone = ANY(v_phones)
    RETURNING id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
              error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source
  ), ins AS (
    INSERT INTO public.whatsapp_messages_archive (id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source)
    SELECT id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source
    FROM moved ON CONFLICT (id) DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_msgs_count FROM ins;
  PERFORM public.wa_archive_summary_refresh(v_phones);
  RETURN QUERY SELECT array_length(v_phones, 1), v_msgs_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_inactive_ads_conversations(p_days integer DEFAULT 30, p_batch_size integer DEFAULT 5000)
 RETURNS TABLE(archived_phones integer, archived_messages integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff timestamptz := now() - (p_days || ' days')::interval;
  v_phones text[];
  v_msgs_count integer := 0;
BEGIN
  SELECT array_agg(phone) INTO v_phones
  FROM (SELECT phone FROM public.whatsapp_messages GROUP BY phone
        HAVING MAX(created_at) < v_cutoff AND bool_or(source = 'ads_lead' OR (referral IS NOT NULL AND referral ? 'ctwa_clid'))
        LIMIT p_batch_size) sub
  WHERE phone NOT IN (
    SELECT DISTINCT regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g')
    FROM public.customers c JOIN public.orders o ON o.customer_id = c.id
    WHERE o.stage NOT IN ('delivered', 'cancelled', 'refunded') AND coalesce(whatsapp, '') <> '');
  IF v_phones IS NULL OR array_length(v_phones, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0; RETURN;
  END IF;
  WITH moved AS (
    DELETE FROM public.whatsapp_messages WHERE phone = ANY(v_phones)
    RETURNING id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
              error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source
  ), ins AS (
    INSERT INTO public.whatsapp_messages_archive (id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source)
    SELECT id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source
    FROM moved ON CONFLICT (id) DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_msgs_count FROM ins;
  PERFORM public.wa_archive_summary_refresh(v_phones);
  RETURN QUERY SELECT array_length(v_phones, 1), v_msgs_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_inactive_broadcast_messages(p_days integer DEFAULT 15, p_batch_size integer DEFAULT 5000)
 RETURNS TABLE(archived_phones integer, archived_messages integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff timestamptz := now() - (p_days || ' days')::interval;
  v_phones text[];
  v_msgs_count integer := 0;
BEGIN
  SELECT array_agg(phone) INTO v_phones
  FROM (SELECT phone FROM public.whatsapp_messages GROUP BY phone
        HAVING MAX(created_at) < v_cutoff AND bool_and(direction = 'outgoing' AND source = 'broadcast') AND COUNT(*) > 0
        LIMIT p_batch_size) sub
  WHERE phone NOT IN (
    SELECT DISTINCT regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g')
    FROM public.customers c JOIN public.orders o ON o.customer_id = c.id
    WHERE o.stage NOT IN ('delivered', 'cancelled', 'refunded') AND coalesce(whatsapp, '') <> '');
  IF v_phones IS NULL OR array_length(v_phones, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0; RETURN;
  END IF;
  WITH moved AS (
    DELETE FROM public.whatsapp_messages WHERE phone = ANY(v_phones)
    RETURNING id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
              error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source
  ), ins AS (
    INSERT INTO public.whatsapp_messages_archive (id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source)
    SELECT id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source
    FROM moved ON CONFLICT (id) DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_msgs_count FROM ins;
  PERFORM public.wa_archive_summary_refresh(v_phones);
  RETURN QUERY SELECT array_length(v_phones, 1), v_msgs_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_old_messages_individual(p_days integer DEFAULT 30, p_batch_size integer DEFAULT 10000, p_keep_recent integer DEFAULT 20)
 RETURNS TABLE(archived_count bigint, affected_phones bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_archived bigint := 0;
  v_phones bigint := 0;
  v_arr text[];
BEGIN
  WITH ranked AS (
    SELECT m.id, m.phone, ROW_NUMBER() OVER (PARTITION BY m.phone ORDER BY m.created_at DESC) AS rn
    FROM public.whatsapp_messages m WHERE m.created_at < (now() - make_interval(days => p_days))
  ), candidates AS (
    SELECT id, phone FROM ranked WHERE rn > p_keep_recent LIMIT p_batch_size
  ), active_phones AS (
    SELECT DISTINCT right(regexp_replace(c.whatsapp, '\D', '', 'g'), 8) AS suffix
    FROM public.orders o JOIN public.customers c ON c.id = o.customer_id
    WHERE coalesce(o.stage, '') NOT IN ('completed','cancelled','shipped') AND c.whatsapp IS NOT NULL
  ), filtered AS (
    SELECT cd.id FROM candidates cd
    WHERE right(regexp_replace(cd.phone, '\D', '', 'g'), 8) NOT IN (SELECT suffix FROM active_phones)
  ), moved AS (
    DELETE FROM public.whatsapp_messages m USING filtered f WHERE m.id = f.id RETURNING m.*
  ), inserted AS (
    INSERT INTO public.whatsapp_messages_archive (id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source, archived_at)
    SELECT id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id, source, now()
    FROM moved ON CONFLICT (id) DO NOTHING RETURNING id, phone
  )
  SELECT count(*), count(DISTINCT phone), array_agg(DISTINCT phone::text) INTO v_archived, v_phones, v_arr FROM inserted;
  PERFORM public.wa_archive_summary_refresh(v_arr);
  RETURN QUERY SELECT v_archived, v_phones;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_old_whatsapp_messages(p_batch_size integer DEFAULT 5000)
 RETURNS TABLE(moved_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_moved int := 0;
  v_arr text[];
BEGIN
  WITH to_move AS (
    SELECT id FROM public.whatsapp_messages WHERE created_at < now() - interval '90 days'
    ORDER BY created_at LIMIT p_batch_size FOR UPDATE SKIP LOCKED
  ), moved AS (
    DELETE FROM public.whatsapp_messages w USING to_move WHERE w.id = to_move.id RETURNING w.*
  ), ins AS (
    INSERT INTO public.whatsapp_messages_archive (id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id)
    SELECT id, phone, message, direction, message_id, status, created_at, media_type, media_url, is_group, whatsapp_number_id, sender_name,
      error_code, error_message, channel, is_mass_dispatch, referral, sender_user_id, quoted_message_id
    FROM moved ON CONFLICT (id) DO NOTHING RETURNING phone
  ) SELECT count(*), array_agg(DISTINCT phone::text) INTO v_moved, v_arr FROM ins;
  PERFORM public.wa_archive_summary_refresh(v_arr);
  moved_count := v_moved;
  RETURN NEXT;
END;
$function$;

-- Busca rápida no histórico (viva + arquivo)
CREATE OR REPLACE FUNCTION public.search_conversations_fast(p_query text, p_limit int DEFAULT 60)
RETURNS TABLE(phone text, whatsapp_number_id uuid, instance_label text, sender_name text, last_message text, last_message_at timestamptz,
  is_group boolean, is_finished boolean, is_archived boolean, only_in_archive boolean, is_dispatch_only boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_query,''), '\D', '', 'g');
  v_text text := btrim(coalesce(p_query,''));
  v_pat text;
  v_by_phone boolean;
BEGIN
  IF length(v_digits) >= 4 THEN
    v_by_phone := true;
    v_pat := '%' || (CASE WHEN length(v_digits) >= 8 THEN right(v_digits, 8) ELSE v_digits END) || '%';
  ELSIF length(v_text) >= 3 THEN
    v_by_phone := false;
    v_pat := '%' || replace(replace(v_text, '%', ''), '_', '') || '%';
  ELSE
    RETURN;
  END IF;

  RETURN QUERY
  WITH live AS (
    SELECT c.phone, c.whatsapp_number_id, c.sender_name, c.last_message, c.last_message_at, coalesce(c.is_group,false) AS is_group,
           (c.last_incoming_at IS NULL) AS dispatch_only, c.instance_key
    FROM public.whatsapp_conversations c
    WHERE (v_by_phone AND c.phone LIKE v_pat) OR (NOT v_by_phone AND c.sender_name ILIKE v_pat)
    ORDER BY c.last_message_at DESC NULLS LAST
    LIMIT p_limit
  ), arch AS (
    SELECT a.phone, a.whatsapp_number_id, a.sender_name, a.last_message, a.last_message_at, false AS is_group, NOT a.has_incoming AS dispatch_only
    FROM public.whatsapp_archive_conversations a
    WHERE ((v_by_phone AND a.phone LIKE v_pat) OR (NOT v_by_phone AND a.sender_name ILIKE v_pat))
      AND NOT EXISTS (SELECT 1 FROM live l WHERE l.phone = a.phone AND l.whatsapp_number_id IS NOT DISTINCT FROM a.whatsapp_number_id)
      AND NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations c2 WHERE c2.phone = a.phone AND c2.whatsapp_number_id IS NOT DISTINCT FROM a.whatsapp_number_id)
    ORDER BY a.last_message_at DESC NULLS LAST
    LIMIT p_limit
  ), u AS (
    SELECT l.phone, l.whatsapp_number_id, l.sender_name, l.last_message, l.last_message_at, l.is_group, l.dispatch_only, false AS only_arch FROM live l
    UNION ALL
    SELECT a.phone, a.whatsapp_number_id, a.sender_name, a.last_message, a.last_message_at, a.is_group, a.dispatch_only, true FROM arch a
  )
  SELECT u.phone, u.whatsapp_number_id, wn.label, u.sender_name, u.last_message, u.last_message_at, u.is_group,
         EXISTS (SELECT 1 FROM public.chat_finished_conversations f WHERE f.phone = u.phone
                   AND (f.whatsapp_number_id IS NOT DISTINCT FROM u.whatsapp_number_id) AND f.finished_at >= u.last_message_at),
         EXISTS (SELECT 1 FROM public.chat_archived_conversations ar WHERE ar.phone = u.phone),
         u.only_arch, u.dispatch_only
  FROM u LEFT JOIN public.whatsapp_numbers wn ON wn.id = u.whatsapp_number_id
  ORDER BY u.last_message_at DESC NULLS LAST
  LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.search_conversations_fast(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_conversations_fast(text, int) TO authenticated, service_role;