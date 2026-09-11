-- ============================================================================
-- Fase 2 — Tabela-resumo whatsapp_conversations (1 linha por telefone+instância)
-- Mantida por triggers a cada INSERT/UPDATE/DELETE em whatsapp_messages.
-- get_conversations passa a ser um SELECT indexado nessa tabela.
-- ============================================================================
SET LOCAL statement_timeout = '600s';

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  phone text NOT NULL,
  instance_key uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  whatsapp_number_id uuid NULL,
  is_group boolean NOT NULL DEFAULT false,
  channel text NULL,
  sender_name text NULL,
  -- última mensagem (todas)
  last_message_id uuid NULL,
  last_message text NULL,
  last_message_at timestamptz NOT NULL,
  last_direction text NULL,
  last_status text NULL,
  last_is_mass_dispatch boolean NOT NULL DEFAULT false,
  -- última mensagem NÃO disparo em massa (modo "regular" da lista)
  nm_last_message_id uuid NULL,
  nm_last_message text NULL,
  nm_last_message_at timestamptz NULL,
  nm_last_direction text NULL,
  nm_last_status text NULL,
  unread_count integer NOT NULL DEFAULT 0,
  last_incoming_at timestamptz NULL,
  last_outgoing_at timestamptz NULL,
  nm_last_outgoing_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone, instance_key)
);

CREATE INDEX IF NOT EXISTS idx_wa_conv_last_at ON public.whatsapp_conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_conv_number_last_at ON public.whatsapp_conversations (whatsapp_number_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_conv_nm_last_at ON public.whatsapp_conversations (nm_last_message_at DESC) WHERE nm_last_message_at IS NOT NULL;

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
GRANT ALL ON public.whatsapp_conversations TO service_role;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_conversations_auth_select" ON public.whatsapp_conversations;
CREATE POLICY "whatsapp_conversations_auth_select" ON public.whatsapp_conversations
  FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- Rebuild de UMA conversa a partir de whatsapp_messages (usado por UPDATE/DELETE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_conv_rebuild(p_phone text, p_number_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key uuid := COALESCE(p_number_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v record;
BEGIN
  IF p_phone IS NULL THEN RETURN; END IF;

  WITH m AS MATERIALIZED (
    SELECT wm.id, wm.message, wm.created_at, wm.direction::text AS direction, wm.status::text AS status,
           COALESCE(wm.is_mass_dispatch, false) AS mass, wm.channel, COALESCE(wm.is_group, false) AS is_group,
           wm.sender_name
    FROM public.whatsapp_messages wm
    WHERE wm.phone = p_phone
      AND wm.whatsapp_number_id IS NOT DISTINCT FROM p_number_id
  ),
  la AS (SELECT id, message, created_at, direction, status, mass, channel FROM m ORDER BY created_at DESC, id DESC LIMIT 1),
  ln AS (SELECT id AS nm_id, message AS nm_message, created_at AS nm_at, direction AS nm_direction, status AS nm_status
         FROM m WHERE NOT mass ORDER BY created_at DESC, id DESC LIMIT 1),
  ag AS (
    SELECT bool_or(is_group) AS is_group,
           COUNT(*) FILTER (WHERE direction = 'incoming' AND (status IS NULL OR status <> 'read')
                              AND created_at > now() - interval '14 days')::int AS unread,
           MAX(created_at) FILTER (WHERE direction = 'incoming') AS last_in,
           MAX(created_at) FILTER (WHERE direction = 'outgoing') AS last_out,
           MAX(created_at) FILTER (WHERE direction = 'outgoing' AND NOT mass) AS nm_last_out
    FROM m
  ),
  sn AS (SELECT sender_name FROM m WHERE direction = 'incoming' AND NULLIF(sender_name, '') IS NOT NULL
         ORDER BY created_at DESC LIMIT 1)
  SELECT la.id, la.message, la.created_at, la.direction, la.status, la.mass, la.channel,
         ln.nm_id, ln.nm_message, ln.nm_at, ln.nm_direction, ln.nm_status,
         ag.is_group, ag.unread, ag.last_in, ag.last_out, ag.nm_last_out,
         sn.sender_name
  INTO v
  FROM ag LEFT JOIN la ON true LEFT JOIN ln ON true LEFT JOIN sn ON true;

  IF v.id IS NULL THEN
    DELETE FROM public.whatsapp_conversations WHERE phone = p_phone AND instance_key = v_key;
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_conversations AS c (
    phone, instance_key, whatsapp_number_id, is_group, channel, sender_name,
    last_message_id, last_message, last_message_at, last_direction, last_status, last_is_mass_dispatch,
    nm_last_message_id, nm_last_message, nm_last_message_at, nm_last_direction, nm_last_status,
    unread_count, last_incoming_at, last_outgoing_at, nm_last_outgoing_at, updated_at
  ) VALUES (
    p_phone, v_key, p_number_id, COALESCE(v.is_group, false), v.channel, v.sender_name,
    v.id, v.message, v.created_at, v.direction, v.status, COALESCE(v.mass, false),
    v.nm_id, v.nm_message, v.nm_at, v.nm_direction, v.nm_status,
    COALESCE(v.unread, 0), v.last_in, v.last_out, v.nm_last_out, now()
  )
  ON CONFLICT (phone, instance_key) DO UPDATE SET
    whatsapp_number_id = EXCLUDED.whatsapp_number_id,
    is_group = EXCLUDED.is_group,
    channel = EXCLUDED.channel,
    sender_name = EXCLUDED.sender_name,
    last_message_id = EXCLUDED.last_message_id,
    last_message = EXCLUDED.last_message,
    last_message_at = EXCLUDED.last_message_at,
    last_direction = EXCLUDED.last_direction,
    last_status = EXCLUDED.last_status,
    last_is_mass_dispatch = EXCLUDED.last_is_mass_dispatch,
    nm_last_message_id = EXCLUDED.nm_last_message_id,
    nm_last_message = EXCLUDED.nm_last_message,
    nm_last_message_at = EXCLUDED.nm_last_message_at,
    nm_last_direction = EXCLUDED.nm_last_direction,
    nm_last_status = EXCLUDED.nm_last_status,
    unread_count = EXCLUDED.unread_count,
    last_incoming_at = EXCLUDED.last_incoming_at,
    last_outgoing_at = EXCLUDED.last_outgoing_at,
    nm_last_outgoing_at = EXCLUDED.nm_last_outgoing_at,
    updated_at = now();
END;
$$;

-- ----------------------------------------------------------------------------
-- Reconciliação em lote (backfill inicial + cron noturno). Modo "merge":
-- last_* só avança, unread é recalculado (fonte da verdade = mensagens).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_conv_reconcile(p_since interval DEFAULT '14 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH m AS MATERIALIZED (
    SELECT wm.id, wm.phone::text AS phone, wm.whatsapp_number_id,
           COALESCE(wm.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid) AS k,
           wm.message, wm.created_at, wm.direction::text AS direction, wm.status::text AS status,
           COALESCE(wm.is_mass_dispatch, false) AS mass, wm.channel, COALESCE(wm.is_group, false) AS is_group,
           wm.sender_name
    FROM public.whatsapp_messages wm
    WHERE wm.created_at > now() - p_since
  ),
  la AS (
    SELECT DISTINCT ON (phone, k) phone, k, whatsapp_number_id, id, message, created_at, direction, status, mass, channel
    FROM m ORDER BY phone, k, created_at DESC, id DESC
  ),
  ln AS (
    SELECT DISTINCT ON (phone, k) phone, k, id AS nm_id, message AS nm_message, created_at AS nm_at,
           direction AS nm_direction, status AS nm_status
    FROM m WHERE NOT mass ORDER BY phone, k, created_at DESC, id DESC
  ),
  ag AS (
    SELECT phone, k,
           bool_or(is_group) AS is_group,
           COUNT(*) FILTER (WHERE direction = 'incoming' AND (status IS NULL OR status <> 'read')
                              AND created_at > now() - interval '14 days')::int AS unread,
           MAX(created_at) FILTER (WHERE direction = 'incoming') AS last_in,
           MAX(created_at) FILTER (WHERE direction = 'outgoing') AS last_out,
           MAX(created_at) FILTER (WHERE direction = 'outgoing' AND NOT mass) AS nm_last_out
    FROM m GROUP BY phone, k
  ),
  sn AS (
    SELECT DISTINCT ON (phone, k) phone, k, sender_name
    FROM m WHERE direction = 'incoming' AND NULLIF(sender_name, '') IS NOT NULL
    ORDER BY phone, k, created_at DESC
  ),
  ins AS (
    INSERT INTO public.whatsapp_conversations AS c (
      phone, instance_key, whatsapp_number_id, is_group, channel, sender_name,
      last_message_id, last_message, last_message_at, last_direction, last_status, last_is_mass_dispatch,
      nm_last_message_id, nm_last_message, nm_last_message_at, nm_last_direction, nm_last_status,
      unread_count, last_incoming_at, last_outgoing_at, nm_last_outgoing_at, updated_at
    )
    SELECT la.phone, la.k, la.whatsapp_number_id, COALESCE(ag.is_group, false), la.channel, sn.sender_name,
           la.id, la.message, la.created_at, la.direction, la.status, la.mass,
           ln.nm_id, ln.nm_message, ln.nm_at, ln.nm_direction, ln.nm_status,
           COALESCE(ag.unread, 0), ag.last_in, ag.last_out, ag.nm_last_out, now()
    FROM la
    JOIN ag ON ag.phone = la.phone AND ag.k = la.k
    LEFT JOIN ln ON ln.phone = la.phone AND ln.k = la.k
    LEFT JOIN sn ON sn.phone = la.phone AND sn.k = la.k
    ON CONFLICT (phone, instance_key) DO UPDATE SET
      is_group = c.is_group OR EXCLUDED.is_group,
      channel = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.channel ELSE c.channel END,
      sender_name = COALESCE(EXCLUDED.sender_name, c.sender_name),
      last_message_id = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_message_id ELSE c.last_message_id END,
      last_message = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_message ELSE c.last_message END,
      last_direction = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_direction ELSE c.last_direction END,
      last_status = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_status ELSE c.last_status END,
      last_is_mass_dispatch = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_is_mass_dispatch ELSE c.last_is_mass_dispatch END,
      last_message_at = GREATEST(c.last_message_at, EXCLUDED.last_message_at),
      nm_last_message_id = CASE WHEN EXCLUDED.nm_last_message_at IS NOT NULL AND EXCLUDED.nm_last_message_at >= COALESCE(c.nm_last_message_at, '-infinity'::timestamptz) THEN EXCLUDED.nm_last_message_id ELSE c.nm_last_message_id END,
      nm_last_message = CASE WHEN EXCLUDED.nm_last_message_at IS NOT NULL AND EXCLUDED.nm_last_message_at >= COALESCE(c.nm_last_message_at, '-infinity'::timestamptz) THEN EXCLUDED.nm_last_message ELSE c.nm_last_message END,
      nm_last_direction = CASE WHEN EXCLUDED.nm_last_message_at IS NOT NULL AND EXCLUDED.nm_last_message_at >= COALESCE(c.nm_last_message_at, '-infinity'::timestamptz) THEN EXCLUDED.nm_last_direction ELSE c.nm_last_direction END,
      nm_last_status = CASE WHEN EXCLUDED.nm_last_message_at IS NOT NULL AND EXCLUDED.nm_last_message_at >= COALESCE(c.nm_last_message_at, '-infinity'::timestamptz) THEN EXCLUDED.nm_last_status ELSE c.nm_last_status END,
      nm_last_message_at = GREATEST(c.nm_last_message_at, EXCLUDED.nm_last_message_at),
      unread_count = EXCLUDED.unread_count,
      last_incoming_at = GREATEST(c.last_incoming_at, EXCLUDED.last_incoming_at),
      last_outgoing_at = GREATEST(c.last_outgoing_at, EXCLUDED.last_outgoing_at),
      nm_last_outgoing_at = GREATEST(c.nm_last_outgoing_at, EXCLUDED.nm_last_outgoing_at),
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$;

-- ----------------------------------------------------------------------------
-- Triggers incrementais em whatsapp_messages
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_conv_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mass boolean := COALESCE(NEW.is_mass_dispatch, false);
  v_in boolean := (NEW.direction::text = 'incoming');
  v_unread integer := CASE WHEN NEW.direction::text = 'incoming' AND (NEW.status IS NULL OR NEW.status::text <> 'read') THEN 1 ELSE 0 END;
BEGIN
  IF NEW.phone IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.whatsapp_conversations AS c (
    phone, instance_key, whatsapp_number_id, is_group, channel, sender_name,
    last_message_id, last_message, last_message_at, last_direction, last_status, last_is_mass_dispatch,
    nm_last_message_id, nm_last_message, nm_last_message_at, nm_last_direction, nm_last_status,
    unread_count, last_incoming_at, last_outgoing_at, nm_last_outgoing_at, updated_at
  ) VALUES (
    NEW.phone::text,
    COALESCE(NEW.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid),
    NEW.whatsapp_number_id,
    COALESCE(NEW.is_group, false),
    NEW.channel,
    CASE WHEN v_in AND NULLIF(NEW.sender_name, '') IS NOT NULL THEN NEW.sender_name END,
    NEW.id, NEW.message, NEW.created_at, NEW.direction::text, NEW.status::text, v_mass,
    CASE WHEN NOT v_mass THEN NEW.id END,
    CASE WHEN NOT v_mass THEN NEW.message END,
    CASE WHEN NOT v_mass THEN NEW.created_at END,
    CASE WHEN NOT v_mass THEN NEW.direction::text END,
    CASE WHEN NOT v_mass THEN NEW.status::text END,
    v_unread,
    CASE WHEN v_in THEN NEW.created_at END,
    CASE WHEN NOT v_in THEN NEW.created_at END,
    CASE WHEN NOT v_in AND NOT v_mass THEN NEW.created_at END,
    now()
  )
  ON CONFLICT (phone, instance_key) DO UPDATE SET
    is_group = c.is_group OR EXCLUDED.is_group,
    channel = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.channel ELSE c.channel END,
    sender_name = CASE WHEN EXCLUDED.sender_name IS NOT NULL
                        AND EXCLUDED.last_message_at >= COALESCE(c.last_incoming_at, '-infinity'::timestamptz)
                       THEN EXCLUDED.sender_name ELSE c.sender_name END,
    last_message_id = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_message_id ELSE c.last_message_id END,
    last_message = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_message ELSE c.last_message END,
    last_direction = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_direction ELSE c.last_direction END,
    last_status = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_status ELSE c.last_status END,
    last_is_mass_dispatch = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at THEN EXCLUDED.last_is_mass_dispatch ELSE c.last_is_mass_dispatch END,
    last_message_at = GREATEST(c.last_message_at, EXCLUDED.last_message_at),
    nm_last_message_id = CASE WHEN EXCLUDED.nm_last_message_at IS NOT NULL AND EXCLUDED.nm_last_message_at >= COALESCE(c.nm_last_message_at, '-infinity'::timestamptz) THEN EXCLUDED.nm_last_message_id ELSE c.nm_last_message_id END,
    nm_last_message = CASE WHEN EXCLUDED.nm_last_message_at IS NOT NULL AND EXCLUDED.nm_last_message_at >= COALESCE(c.nm_last_message_at, '-infinity'::timestamptz) THEN EXCLUDED.nm_last_message ELSE c.nm_last_message END,
    nm_last_direction = CASE WHEN EXCLUDED.nm_last_message_at IS NOT NULL AND EXCLUDED.nm_last_message_at >= COALESCE(c.nm_last_message_at, '-infinity'::timestamptz) THEN EXCLUDED.nm_last_direction ELSE c.nm_last_direction END,
    nm_last_status = CASE WHEN EXCLUDED.nm_last_message_at IS NOT NULL AND EXCLUDED.nm_last_message_at >= COALESCE(c.nm_last_message_at, '-infinity'::timestamptz) THEN EXCLUDED.nm_last_status ELSE c.nm_last_status END,
    nm_last_message_at = GREATEST(c.nm_last_message_at, EXCLUDED.nm_last_message_at),
    unread_count = c.unread_count + EXCLUDED.unread_count,
    last_incoming_at = GREATEST(c.last_incoming_at, EXCLUDED.last_incoming_at),
    last_outgoing_at = GREATEST(c.last_outgoing_at, EXCLUDED.last_outgoing_at),
    nm_last_outgoing_at = GREATEST(c.nm_last_outgoing_at, EXCLUDED.nm_last_outgoing_at),
    updated_at = now();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_conv_on_insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_conv_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_unread integer;
  v_new_unread integer;
  v_delta integer;
BEGIN
  -- Mudanças estruturais (telefone/instância/data/direção/mass): recalcula do zero.
  IF NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.whatsapp_number_id IS DISTINCT FROM OLD.whatsapp_number_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.is_mass_dispatch IS DISTINCT FROM OLD.is_mass_dispatch THEN
    PERFORM public.wa_conv_rebuild(OLD.phone::text, OLD.whatsapp_number_id);
    IF NEW.phone IS DISTINCT FROM OLD.phone OR NEW.whatsapp_number_id IS DISTINCT FROM OLD.whatsapp_number_id THEN
      PERFORM public.wa_conv_rebuild(NEW.phone::text, NEW.whatsapp_number_id);
    END IF;
    RETURN NEW;
  END IF;

  v_old_unread := CASE WHEN OLD.direction::text = 'incoming' AND (OLD.status IS NULL OR OLD.status::text <> 'read') THEN 1 ELSE 0 END;
  v_new_unread := CASE WHEN NEW.direction::text = 'incoming' AND (NEW.status IS NULL OR NEW.status::text <> 'read') THEN 1 ELSE 0 END;
  v_delta := v_new_unread - v_old_unread;

  IF v_delta <> 0
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.message IS DISTINCT FROM OLD.message THEN
    UPDATE public.whatsapp_conversations c SET
      unread_count = GREATEST(0, c.unread_count + v_delta),
      last_status = CASE WHEN c.last_message_id = NEW.id THEN NEW.status::text ELSE c.last_status END,
      last_message = CASE WHEN c.last_message_id = NEW.id THEN NEW.message ELSE c.last_message END,
      nm_last_status = CASE WHEN c.nm_last_message_id = NEW.id THEN NEW.status::text ELSE c.nm_last_status END,
      nm_last_message = CASE WHEN c.nm_last_message_id = NEW.id THEN NEW.message ELSE c.nm_last_message END,
      updated_at = now()
    WHERE c.phone = NEW.phone::text
      AND c.instance_key = COALESCE(NEW.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_conv_on_update failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_conv_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  -- Só conversas com mensagens recentes importam para a lista; apagar histórico
  -- antigo (arquivamento) não precisa recalcular milhares de resumos.
  FOR r IN
    SELECT DISTINCT o.phone::text AS phone, o.whatsapp_number_id
    FROM old_rows o
    WHERE o.created_at > now() - interval '30 days'
  LOOP
    PERFORM public.wa_conv_rebuild(r.phone, r.whatsapp_number_id);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_conv_on_delete failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_conv_on_insert ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_conv_on_insert
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.wa_conv_on_insert();

DROP TRIGGER IF EXISTS trg_wa_conv_on_update ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_conv_on_update
  AFTER UPDATE OF status, message, phone, whatsapp_number_id, created_at, direction, is_mass_dispatch
  ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.wa_conv_on_update();

DROP TRIGGER IF EXISTS trg_wa_conv_on_delete ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_conv_on_delete
  AFTER DELETE ON public.whatsapp_messages
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.wa_conv_on_delete();

-- ----------------------------------------------------------------------------
-- Broadcast de UPDATE passa a informar a direção (cliente decide se reage)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_wa_message_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime'
AS $function$
BEGIN
  IF COALESCE(NEW.is_mass_dispatch, false) = true THEN RETURN NEW; END IF;
  IF (NEW.status IS NOT DISTINCT FROM OLD.status)
     AND (NEW.media_url IS NOT DISTINCT FROM OLD.media_url) THEN
    RETURN NEW;
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'phone', NEW.phone,
      'whatsapp_number_id', NEW.whatsapp_number_id,
      'direction', NEW.direction,
      'message_id', NEW.message_id,
      'status', NEW.status
    ),
    'wa_msg_update',
    'wa_msg_inserts',
    false
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $function$;

-- ----------------------------------------------------------------------------
-- RPC única: várias instâncias de uma vez, paginada (contorna o corte de 1000)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_conversations_multi(
  p_number_ids uuid[] DEFAULT NULL,
  p_dispatch_only boolean DEFAULT NULL,
  p_include_unassigned boolean DEFAULT false,
  p_limit integer DEFAULT 1000,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  phone text, last_message text, last_message_at timestamptz, unread_count bigint, direction text,
  is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean,
  is_dispatch_only boolean, channel text, has_incoming boolean, last_is_mass_dispatch boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT c.*, (now() - interval '14 days') AS cutoff
    FROM public.whatsapp_conversations c
    WHERE c.last_message_at > now() - interval '14 days'
      AND (
        p_number_ids IS NULL
        OR c.whatsapp_number_id = ANY (p_number_ids)
        OR (p_include_unassigned AND c.whatsapp_number_id IS NULL)
      )
  ),
  r AS (
    SELECT
      b.phone,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_message ELSE b.last_message END AS last_message,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_message_at ELSE b.last_message_at END AS last_message_at,
      b.unread_count::bigint AS unread_count,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_direction ELSE b.last_direction END AS direction,
      b.is_group,
      b.whatsapp_number_id,
      b.sender_name,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_status ELSE b.last_status END AS status,
      COALESCE(CASE WHEN p_dispatch_only = false THEN b.nm_last_outgoing_at > b.cutoff ELSE b.last_outgoing_at > b.cutoff END, false) AS has_outgoing,
      COALESCE(b.last_incoming_at > b.cutoff, false) AS has_incoming,
      b.channel,
      CASE WHEN p_dispatch_only = false THEN false ELSE b.last_is_mass_dispatch END AS last_is_mass_dispatch
    FROM base b
    WHERE p_dispatch_only IS DISTINCT FROM false OR b.nm_last_message_at > b.cutoff
  ),
  r2 AS (
    SELECT r.*,
      (
        (r.last_is_mass_dispatch AND r.direction = 'outgoing')
        OR (r.direction = 'outgoing' AND NOT r.has_incoming AND (r.channel IS NULL OR r.channel NOT IN ('instagram', 'messenger')))
      ) AS is_dispatch_only
    FROM r
  )
  SELECT phone, last_message, last_message_at, unread_count, direction, is_group, whatsapp_number_id,
         sender_name, status, has_outgoing, is_dispatch_only, channel, has_incoming, last_is_mass_dispatch
  FROM r2
  WHERE CASE
    WHEN p_dispatch_only = true THEN is_dispatch_only
    WHEN p_dispatch_only = false THEN NOT is_dispatch_only
    ELSE true
  END
  ORDER BY last_message_at DESC, phone, whatsapp_number_id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1000), 5000))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

REVOKE ALL ON FUNCTION public.get_conversations_multi(uuid[], boolean, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversations_multi(uuid[], boolean, boolean, integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.wa_conv_rebuild(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_conv_reconcile(interval) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- get_conversations (assinatura antiga) passa a ler a tabela-resumo.
-- Todos os chamadores existentes ficam rápidos sem mudar código.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_conversations(p_number_id uuid DEFAULT NULL::uuid, p_dispatch_only boolean DEFAULT NULL::boolean)
RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, unread_count bigint, direction text, is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean, is_dispatch_only boolean, channel text, has_incoming boolean, last_is_mass_dispatch boolean)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT * FROM public.get_conversations_multi(
    CASE WHEN p_number_id IS NULL THEN NULL ELSE ARRAY[p_number_id] END,
    p_dispatch_only,
    (p_number_id IS NULL),
    5000,
    0
  );
$$;

-- ----------------------------------------------------------------------------
-- Backfill inicial (últimos 14 dias — mesma janela que a lista exibe hoje)
-- ----------------------------------------------------------------------------
SELECT public.wa_conv_reconcile('14 days'::interval);

-- ----------------------------------------------------------------------------
-- Reconciliação noturna (01:15 BRT) como rede de segurança contra desvios
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'wa-conv-reconcile-nightly';
    PERFORM cron.schedule('wa-conv-reconcile-nightly', '15 4 * * *', $job$SELECT public.wa_conv_reconcile('14 days'::interval)$job$);
  END IF;
END $$;