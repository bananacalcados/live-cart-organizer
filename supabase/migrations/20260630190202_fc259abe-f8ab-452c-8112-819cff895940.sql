-- ============================================================
-- ITEM 1: Otimizar get_conversation_counts (cache + 1 varredura)
-- ============================================================

-- Tabela de cache (linha única). Acessada apenas pela função SECURITY DEFINER.
CREATE TABLE IF NOT EXISTS public.conversation_counts_cache (
  id integer PRIMARY KEY DEFAULT 1,
  awaiting_count bigint NOT NULL DEFAULT 0,
  new_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_counts_cache_single_row CHECK (id = 1)
);

INSERT INTO public.conversation_counts_cache (id, updated_at)
VALUES (1, now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;

GRANT ALL ON public.conversation_counts_cache TO service_role;

ALTER TABLE public.conversation_counts_cache ENABLE ROW LEVEL SECURITY;
-- Sem políticas: tabela é tocada exclusivamente pela função SECURITY DEFINER (dona da tabela).

-- Reescrita da função: lê do cache (fresco < 20s); se obsoleto, apenas UMA sessão
-- recalcula (advisory lock) com varredura ÚNICA; as demais retornam o último valor.
CREATE OR REPLACE FUNCTION public.get_conversation_counts()
RETURNS TABLE(awaiting_count bigint, new_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_awaiting bigint;
  v_new bigint;
  v_updated timestamptz;
BEGIN
  SELECT c.awaiting_count, c.new_count, c.updated_at
    INTO v_awaiting, v_new, v_updated
    FROM conversation_counts_cache c
    WHERE c.id = 1;

  -- Cache fresco: retorna imediatamente.
  IF v_updated IS NOT NULL AND v_updated > now() - interval '20 seconds' THEN
    awaiting_count := v_awaiting;
    new_count := v_new;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Cache obsoleto: somente uma sessão recalcula; as demais devolvem o último valor.
  IF NOT pg_try_advisory_xact_lock(927312001) THEN
    awaiting_count := COALESCE(v_awaiting, 0);
    new_count := COALESCE(v_new, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  WITH agg AS (
    SELECT
      phone,
      (array_agg(direction ORDER BY created_at DESC))[1] AS last_direction,
      max(created_at) AS last_created,
      bool_or(direction = 'outgoing') AS has_outgoing
    FROM whatsapp_messages
    WHERE created_at > now() - interval '90 days'
    GROUP BY phone
  ),
  finished AS (
    SELECT DISTINCT ON (phone) phone, finished_at
    FROM chat_finished_conversations
    ORDER BY phone, finished_at DESC
  ),
  active AS (
    SELECT a.has_outgoing
    FROM agg a
    LEFT JOIN finished f ON f.phone = a.phone
    WHERE a.last_direction = 'incoming'
      AND (f.finished_at IS NULL OR f.finished_at < a.last_created)
  )
  SELECT
    COUNT(*) FILTER (WHERE has_outgoing),
    COUNT(*) FILTER (WHERE NOT has_outgoing)
  INTO v_awaiting, v_new
  FROM active;

  UPDATE conversation_counts_cache
    SET awaiting_count = v_awaiting,
        new_count = v_new,
        updated_at = now()
    WHERE id = 1;

  awaiting_count := v_awaiting;
  new_count := v_new;
  RETURN NEXT;
  RETURN;
END;
$function$;

-- ============================================================
-- ITEM 2: Índices trigram para buscas ilike '%suffix%' de telefone
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_pos_sales_customer_phone_trgm
  ON public.pos_sales USING gin (customer_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_whatsapp_trgm
  ON public.customers USING gin (whatsapp gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_pos_customers_whatsapp_trgm
  ON public.pos_customers USING gin (whatsapp gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_expedition_orders_customer_phone_trgm
  ON public.expedition_orders USING gin (customer_phone gin_trgm_ops);