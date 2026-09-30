
-- Resolve categoria do template Meta no momento do envio
CREATE OR REPLACE FUNCTION public.resolve_meta_template_category(p_template text, p_wn uuid, p_fallback text DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT upper(COALESCE(
    (SELECT a.new_category FROM meta_template_category_alerts a
      WHERE p_template IS NOT NULL AND a.template_name = p_template
        AND (p_wn IS NULL OR a.whatsapp_number_id IS NULL OR a.whatsapp_number_id = p_wn)
      ORDER BY a.detected_at DESC NULLS LAST LIMIT 1),
    (SELECT t.template_category FROM templates_carrossel t
      WHERE p_template IS NOT NULL AND t.template_category IS NOT NULL
        AND (t.template_id = p_template OR t.nome = p_template)
      ORDER BY (t.whatsapp_number_id = p_wn) DESC NULLS LAST, t.category_last_synced_at DESC NULLS LAST LIMIT 1),
    NULLIF(p_fallback, ''),
    (SELECT d.template_category FROM dispatch_history d
      WHERE p_template IS NOT NULL AND d.template_name = p_template AND d.template_category IS NOT NULL
      ORDER BY d.created_at DESC LIMIT 1)
  ))
$$;

CREATE OR REPLACE FUNCTION public.dispatch_unit_cost_for(p_category text, p_provider text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN COALESCE(p_provider,'') NOT ILIKE '%meta%' THEN 0
    ELSE COALESCE((SELECT unit_cost_brl FROM dispatch_unit_cost_rates WHERE category = upper(p_category)), 0) END
$$;

CREATE OR REPLACE FUNCTION public.wn_provider(p_wn uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN provider IN ('meta','meta_cloud') THEN 'meta_cloud' ELSE provider END FROM whatsapp_numbers WHERE id = p_wn
$$;

-- dispatch_history: grava na criação ou quando o disparo começa
CREATE OR REPLACE FUNCTION public.trg_stamp_cost_dispatch_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.unit_cost_at_send IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT (OLD.started_at IS NULL AND NEW.started_at IS NOT NULL) THEN RETURN NEW; END IF;
  NEW.provider_at_send := COALESCE(NEW.provider_at_send, NEW.provider, wn_provider(NEW.whatsapp_number_id));
  NEW.template_category_at_send := COALESCE(NEW.template_category_at_send,
    resolve_meta_template_category(NEW.template_name, NEW.whatsapp_number_id, NEW.template_category));
  NEW.unit_cost_at_send := dispatch_unit_cost_for(NEW.template_category_at_send, NEW.provider_at_send);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_cost ON public.dispatch_history;
CREATE TRIGGER trg_stamp_cost BEFORE INSERT OR UPDATE ON public.dispatch_history
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_cost_dispatch_history();

-- dispatch_recipients
CREATE OR REPLACE FUNCTION public.trg_stamp_cost_dispatch_recipients()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record;
BEGIN
  IF NEW.status IS DISTINCT FROM 'sent' OR NEW.unit_cost_at_send IS NOT NULL
     OR (TG_OP = 'UPDATE' AND OLD.status = 'sent') THEN RETURN NEW; END IF;
  SELECT * INTO d FROM dispatch_history WHERE id = NEW.dispatch_id;
  NEW.provider_at_send := COALESCE(NEW.provider_at_send, NEW.fallback_provider, d.provider, wn_provider(d.whatsapp_number_id));
  NEW.template_category_at_send := COALESCE(NEW.template_category_at_send, d.template_category_at_send,
    resolve_meta_template_category(d.template_name, d.whatsapp_number_id, d.template_category));
  NEW.unit_cost_at_send := dispatch_unit_cost_for(NEW.template_category_at_send, NEW.provider_at_send);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_cost ON public.dispatch_recipients;
CREATE TRIGGER trg_stamp_cost BEFORE INSERT OR UPDATE ON public.dispatch_recipients
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_cost_dispatch_recipients();

-- live_campaign_dispatches
CREATE OR REPLACE FUNCTION public.trg_stamp_cost_live_campaign_dispatches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tpl text; v_wn uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'sent' OR NEW.unit_cost_at_send IS NOT NULL
     OR (TG_OP = 'UPDATE' AND OLD.status = 'sent') THEN RETURN NEW; END IF;
  SELECT m.meta_template_name INTO v_tpl FROM live_campaign_messages m WHERE m.id = NEW.message_id;
  v_wn := COALESCE(NEW.whatsapp_number_id, (SELECT whatsapp_number_id FROM live_campaigns WHERE id = NEW.campaign_id));
  NEW.provider_at_send := COALESCE(NEW.provider_at_send,
    CASE WHEN NEW.channel = 'instagram' THEN 'instagram' END, wn_provider(v_wn));
  NEW.template_category_at_send := COALESCE(NEW.template_category_at_send,
    CASE WHEN v_tpl IS NOT NULL THEN resolve_meta_template_category(v_tpl, v_wn, NULL)
         WHEN NEW.provider_at_send ILIKE '%meta%' THEN 'SERVICE' END);
  NEW.unit_cost_at_send := dispatch_unit_cost_for(NEW.template_category_at_send, NEW.provider_at_send);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_cost ON public.live_campaign_dispatches;
CREATE TRIGGER trg_stamp_cost BEFORE INSERT OR UPDATE ON public.live_campaign_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_cost_live_campaign_dispatches();

-- mass_dispatch_targets (texto livre: sem template)
CREATE OR REPLACE FUNCTION public.trg_stamp_cost_mass_dispatch_targets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'sent' OR NEW.unit_cost_at_send IS NOT NULL
     OR (TG_OP = 'UPDATE' AND OLD.status = 'sent') THEN RETURN NEW; END IF;
  NEW.provider_at_send := COALESCE(NEW.provider_at_send,
    wn_provider((SELECT whatsapp_number_id FROM mass_dispatch_campaigns WHERE id = NEW.campaign_id)));
  NEW.template_category_at_send := COALESCE(NEW.template_category_at_send,
    CASE WHEN NEW.provider_at_send ILIKE '%meta%' THEN 'SERVICE' END);
  NEW.unit_cost_at_send := dispatch_unit_cost_for(NEW.template_category_at_send, NEW.provider_at_send);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_cost ON public.mass_dispatch_targets;
CREATE TRIGGER trg_stamp_cost BEFORE INSERT OR UPDATE ON public.mass_dispatch_targets
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_cost_mass_dispatch_targets();

-- automation_dispatch_sent
CREATE OR REPLACE FUNCTION public.trg_stamp_cost_automation_dispatch_sent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cfg jsonb; v_wn uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'sent' OR NEW.unit_cost_at_send IS NOT NULL
     OR (TG_OP = 'UPDATE' AND OLD.status = 'sent') THEN RETURN NEW; END IF;
  SELECT s.action_config INTO v_cfg FROM automation_steps s
   WHERE s.flow_id = NEW.flow_id AND s.action_type = 'send_template'
   ORDER BY s.step_order LIMIT 1;
  BEGIN v_wn := NULLIF(v_cfg->>'whatsappNumberId','')::uuid; EXCEPTION WHEN others THEN v_wn := NULL; END;
  NEW.provider_at_send := COALESCE(NEW.provider_at_send, wn_provider(v_wn), CASE WHEN v_cfg IS NOT NULL THEN 'meta_cloud' END);
  NEW.template_category_at_send := COALESCE(NEW.template_category_at_send,
    resolve_meta_template_category(v_cfg->>'templateName', v_wn, NULL));
  NEW.unit_cost_at_send := dispatch_unit_cost_for(NEW.template_category_at_send, NEW.provider_at_send);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_cost ON public.automation_dispatch_sent;
CREATE TRIGGER trg_stamp_cost BEFORE INSERT OR UPDATE ON public.automation_dispatch_sent
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_cost_automation_dispatch_sent();

-- campanha_envios (carrossel/campanhas automáticas)
CREATE OR REPLACE FUNCTION public.trg_stamp_cost_campanha_envios()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  IF NEW.status IS DISTINCT FROM 'enviado' OR NEW.unit_cost_at_send IS NOT NULL
     OR (TG_OP = 'UPDATE' AND OLD.status IN ('enviado','entregue','lido')) THEN RETURN NEW; END IF;
  SELECT * INTO c FROM campanhas_auto WHERE id = NEW.campanha_id;
  NEW.provider_at_send := COALESCE(NEW.provider_at_send, NEW.fallback_provider, wn_provider(c.whatsapp_number_id));
  NEW.template_category_at_send := COALESCE(NEW.template_category_at_send,
    resolve_meta_template_category(c.template_modelo, c.whatsapp_number_id, c.template_categoria));
  NEW.unit_cost_at_send := dispatch_unit_cost_for(NEW.template_category_at_send, NEW.provider_at_send);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_cost ON public.campanha_envios;
CREATE TRIGGER trg_stamp_cost BEFORE INSERT OR UPDATE ON public.campanha_envios
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_cost_campanha_envios();

REVOKE EXECUTE ON FUNCTION public.resolve_meta_template_category(text,uuid,text), public.dispatch_unit_cost_for(text,text), public.wn_provider(uuid) FROM PUBLIC, anon;
