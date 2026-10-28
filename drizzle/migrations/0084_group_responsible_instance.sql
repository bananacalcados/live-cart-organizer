CREATE TABLE public.whatsapp_group_responsible (
  group_jid_base text PRIMARY KEY,
  instance_id uuid,
  mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','manual')),
  health text NOT NULL DEFAULT 'sem_responsavel' CHECK (health IN ('ok','sem_admin','sem_responsavel')),
  since timestamptz NOT NULL DEFAULT now(),
  reason text,
  pending_instance_id uuid,
  pending_reason text,
  pending_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.whatsapp_group_responsible TO authenticated;
GRANT ALL ON public.whatsapp_group_responsible TO service_role;
ALTER TABLE public.whatsapp_group_responsible ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read group responsible" ON public.whatsapp_group_responsible FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TABLE public.whatsapp_group_responsible_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid_base text NOT NULL,
  group_name text,
  kind text NOT NULL,
  old_instance_id uuid,
  new_instance_id uuid,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE INDEX whatsapp_group_responsible_alerts_recent ON public.whatsapp_group_responsible_alerts (created_at DESC);
GRANT SELECT ON public.whatsapp_group_responsible_alerts TO authenticated;
GRANT ALL ON public.whatsapp_group_responsible_alerts TO service_role;
ALTER TABLE public.whatsapp_group_responsible_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read group responsible alerts" ON public.whatsapp_group_responsible_alerts FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

INSERT INTO public.app_settings(key, value)
SELECT 'group_responsible_order', '["0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c","1f715932-e118-4e88-8051-85a5c14f5a4b","fb7dd381-6460-4f28-8d01-f15943edb879"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key='group_responsible_order');

-- Participação de cada instância ativa no grupo lógico
CREATE OR REPLACE FUNCTION public.group_instance_presence(p_base text)
RETURNS TABLE(instance_id uuid, label text, present boolean, is_admin boolean, ord int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH ord AS (
    SELECT (e.v)::uuid AS id, e.n::int AS n
    FROM app_settings s, jsonb_array_elements_text(s.value) WITH ORDINALITY e(v,n)
    WHERE s.key='group_responsible_order'
  ), rows AS (
    SELECT n.id, n.label, bool_or(g.is_active) AS active, bool_or(coalesce(g.is_admin,false)) AS admin_flag,
           right(regexp_replace(coalesce(n.phone_display,''),'\D','','g'),8) AS k
    FROM whatsapp_groups g
    JOIN whatsapp_numbers n ON n.is_active AND (g.instance_id = n.id::text OR g.instance_id = n.zapi_instance_id OR g.instance_id = n.uazapi_instance_name)
    WHERE g.group_jid_base = p_base
    GROUP BY n.id, n.label, n.phone_display
  )
  SELECT r.id, r.label,
         r.active AND coalesce(m.status,'member') <> 'left',
         r.admin_flag OR coalesce(m.is_admin,false),
         coalesce(o.n, 1000)
  FROM rows r
  LEFT JOIN ord o ON o.id = r.id
  LEFT JOIN LATERAL (
    SELECT wm.status, wm.is_admin FROM whatsapp_group_members wm
    WHERE wm.group_jid_base = p_base AND length(r.k)=8 AND right(wm.phone,8) = r.k
    ORDER BY wm.updated_at DESC LIMIT 1
  ) m ON true
$$;

CREATE OR REPLACE FUNCTION public.group_send_in_progress(p_base text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM group_admin_actions a
                 WHERE a.status IN ('pending','processing','running','sending','queued','claimed','in_progress')
                   AND split_part(split_part(a.group_jid,'@',1),'-',1) = p_base)
      OR EXISTS (SELECT 1 FROM group_campaign_block_dispatches d
                 WHERE d.status IN ('pending','processing','running','sending','queued','claimed','in_progress')
                   AND split_part(split_part(d.group_zapi_id,'@',1),'-',1) = p_base)
$$;

CREATE OR REPLACE FUNCTION public.recompute_group_responsible(p_base text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  cur whatsapp_group_responsible;
  cand_id uuid; cand_admin boolean; v_health text; v_mode text; v_reason text;
  manual_present boolean; manual_admin boolean;
  v_name text; old_label text; new_label text; v_msg text; v_kind text;
BEGIN
  IF p_base IS NULL OR p_base = '' THEN RETURN NULL; END IF;
  SELECT * INTO cur FROM whatsapp_group_responsible WHERE group_jid_base = p_base FOR UPDATE;
  SELECT name INTO v_name FROM whatsapp_groups WHERE group_jid_base = p_base ORDER BY last_synced_at DESC NULLS LAST LIMIT 1;

  SELECT instance_id, is_admin INTO cand_id, cand_admin FROM group_instance_presence(p_base)
   WHERE present ORDER BY is_admin DESC, ord, label LIMIT 1;
  v_mode := 'auto';

  IF cur.mode = 'manual' AND cur.instance_id IS NOT NULL THEN
    SELECT present, is_admin INTO manual_present, manual_admin FROM group_instance_presence(p_base) WHERE instance_id = cur.instance_id;
    IF coalesce(manual_present,false) THEN
      cand_id := cur.instance_id; cand_admin := coalesce(manual_admin,false); v_mode := 'manual';
    END IF;
  END IF;

  v_health := CASE WHEN cand_id IS NULL THEN 'sem_responsavel' WHEN cand_admin THEN 'ok' ELSE 'sem_admin' END;
  v_reason := CASE WHEN v_mode='manual' THEN 'definida manualmente'
                   WHEN cand_id IS NULL THEN 'nenhuma instância no grupo'
                   WHEN cand_admin THEN 'primeira da ordem que é admin'
                   ELSE 'primeira da ordem no grupo (sem admin)' END;

  IF cur.group_jid_base IS NULL THEN
    INSERT INTO whatsapp_group_responsible(group_jid_base, instance_id, mode, health, reason)
    VALUES (p_base, cand_id, v_mode, v_health, v_reason);
    RETURN v_health;
  END IF;

  IF cur.instance_id IS NOT DISTINCT FROM cand_id THEN
    UPDATE whatsapp_group_responsible SET health=v_health, mode=v_mode, reason=v_reason,
      pending_instance_id=NULL, pending_reason=NULL, pending_since=NULL, updated_at=now()
    WHERE group_jid_base=p_base
      AND (health IS DISTINCT FROM v_health OR mode IS DISTINCT FROM v_mode OR reason IS DISTINCT FROM v_reason OR pending_instance_id IS NOT NULL);
    RETURN v_health;
  END IF;

  -- Troca: espera fim de envio/ação em andamento para o grupo
  IF group_send_in_progress(p_base) THEN
    UPDATE whatsapp_group_responsible SET pending_instance_id=cand_id, pending_reason=v_reason,
      pending_since=coalesce(pending_since, now()), updated_at=now()
    WHERE group_jid_base=p_base AND pending_instance_id IS DISTINCT FROM cand_id;
    RETURN 'aguardando_envio';
  END IF;

  SELECT label INTO old_label FROM whatsapp_numbers WHERE id = cur.instance_id;
  SELECT label INTO new_label FROM whatsapp_numbers WHERE id = cand_id;
  IF cand_id IS NULL THEN
    v_kind := 'sem_responsavel';
    v_msg := format('Grupo %s ficou sem responsável', coalesce(v_name, p_base));
  ELSE
    v_kind := CASE WHEN cur.mode='manual' AND v_mode='auto' THEN 'manual_revertido' ELSE 'troca' END;
    v_msg := format('%s saiu do grupo %s ou perdeu admin — %s assumiu%s',
      coalesce(old_label,'(nenhuma)'), coalesce(v_name,p_base), new_label,
      CASE WHEN v_kind='manual_revertido' THEN ' (escolha manual voltou para automático)' ELSE '' END);
    IF cur.instance_id IS NULL THEN v_msg := format('%s assumiu o grupo %s', new_label, coalesce(v_name,p_base)); END IF;
  END IF;

  UPDATE whatsapp_group_responsible SET instance_id=cand_id, mode=v_mode, health=v_health, reason=v_reason,
    since=now(), pending_instance_id=NULL, pending_reason=NULL, pending_since=NULL, updated_at=now()
  WHERE group_jid_base=p_base;
  INSERT INTO whatsapp_group_responsible_alerts(group_jid_base, group_name, kind, old_instance_id, new_instance_id, message)
  VALUES (p_base, v_name, v_kind, cur.instance_id, cand_id, v_msg);
  RETURN v_health;
END $$;

CREATE OR REPLACE FUNCTION public.recompute_all_group_responsible()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b text; n int := 0;
BEGIN
  FOR b IN SELECT DISTINCT group_jid_base FROM whatsapp_groups WHERE group_jid_base IS NOT NULL AND group_jid_base <> '' ORDER BY 1 LOOP
    PERFORM recompute_group_responsible(b); n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Gatilhos: sincronização de grupo
CREATE OR REPLACE FUNCTION public.trg_group_responsible_from_groups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM recompute_group_responsible(NEW.group_jid_base); RETURN NULL; END $$;
CREATE TRIGGER trg_group_responsible_groups_ins AFTER INSERT ON public.whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION public.trg_group_responsible_from_groups();
CREATE TRIGGER trg_group_responsible_groups_upd AFTER UPDATE ON public.whatsapp_groups
  FOR EACH ROW WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active OR OLD.is_admin IS DISTINCT FROM NEW.is_admin
    OR OLD.instance_id IS DISTINCT FROM NEW.instance_id OR OLD.group_jid_base IS DISTINCT FROM NEW.group_jid_base)
  EXECUTE FUNCTION public.trg_group_responsible_from_groups();

-- Gatilho: membro que é uma das nossas instâncias saiu/entrou/perdeu admin
CREATE OR REPLACE FUNCTION public.trg_group_responsible_from_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM whatsapp_numbers n WHERE n.is_active
             AND length(regexp_replace(coalesce(n.phone_display,''),'\D','','g')) >= 8
             AND right(regexp_replace(n.phone_display,'\D','','g'),8) = right(NEW.phone,8)) THEN
    PERFORM recompute_group_responsible(NEW.group_jid_base);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_group_responsible_members_ins AFTER INSERT ON public.whatsapp_group_members
  FOR EACH ROW EXECUTE FUNCTION public.trg_group_responsible_from_members();
CREATE TRIGGER trg_group_responsible_members_upd AFTER UPDATE ON public.whatsapp_group_members
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_admin IS DISTINCT FROM NEW.is_admin)
  EXECUTE FUNCTION public.trg_group_responsible_from_members();

-- Gatilho: fim de envio/ação libera troca pendente
CREATE OR REPLACE FUNCTION public.trg_group_responsible_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b text;
BEGIN
  b := split_part(split_part(CASE WHEN TG_TABLE_NAME='group_admin_actions' THEN NEW.group_jid ELSE NEW.group_zapi_id END,'@',1),'-',1);
  IF EXISTS (SELECT 1 FROM whatsapp_group_responsible r WHERE r.group_jid_base=b AND r.pending_instance_id IS NOT NULL OR (r.group_jid_base=b AND r.pending_since IS NOT NULL)) THEN
    PERFORM recompute_group_responsible(b);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_group_responsible_release_admin AFTER UPDATE ON public.group_admin_actions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('done','failed','cancelled','sent'))
  EXECUTE FUNCTION public.trg_group_responsible_release();
CREATE TRIGGER trg_group_responsible_release_disp AFTER UPDATE ON public.group_campaign_block_dispatches
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('done','failed','cancelled','sent'))
  EXECUTE FUNCTION public.trg_group_responsible_release();

REVOKE ALL ON FUNCTION public.group_instance_presence(text), public.group_send_in_progress(text),
  public.recompute_group_responsible(text), public.recompute_all_group_responsible(),
  public.trg_group_responsible_from_groups(), public.trg_group_responsible_from_members(),
  public.trg_group_responsible_release() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.group_instance_presence(text), public.recompute_group_responsible(text),
  public.recompute_all_group_responsible() TO service_role;

SELECT public.recompute_all_group_responsible();