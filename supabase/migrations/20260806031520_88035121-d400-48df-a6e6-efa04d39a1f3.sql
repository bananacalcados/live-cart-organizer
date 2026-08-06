ALTER TABLE public.campanhas_auto
  ADD COLUMN IF NOT EXISTS template_tipo text NOT NULL DEFAULT 'carrossel',
  ADD COLUMN IF NOT EXISTS template_language text;

CREATE OR REPLACE FUNCTION public.resolve_campaign_template(p_campanha_id uuid)
 RETURNS templates_carrossel
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.campanhas_auto;
  v_ok_count integer;
  v_tpl public.templates_carrossel;
BEGIN
  SELECT * INTO c FROM public.campanhas_auto WHERE id = p_campanha_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Templates simples (texto ou imagem+texto): o nome do template da Meta fica
  -- direto em campanhas_auto.template_modelo, sem depender de cards.
  IF COALESCE(c.template_tipo, 'carrossel') = 'simples' THEN
    IF c.template_modelo IS NULL OR btrim(c.template_modelo) = '' THEN RETURN NULL; END IF;
    v_tpl.template_id := c.template_modelo;
    v_tpl.template_language := COALESCE(c.template_language, 'pt_BR');
    v_tpl.nome := c.template_modelo;
    v_tpl.qtd_cards := 0;
    v_tpl.aprovado := true;
    v_tpl.whatsapp_number_id := c.whatsapp_number_id;
    RETURN v_tpl;
  END IF;

  SELECT count(*) INTO v_ok_count
  FROM public.campanha_cards
  WHERE campanha_id = p_campanha_id AND status = 'ok';

  IF v_ok_count < 2 THEN RETURN NULL; END IF;
  IF v_ok_count > 10 THEN v_ok_count := 10; END IF;

  SELECT * INTO v_tpl
  FROM public.templates_carrossel t
  WHERE t.qtd_cards = v_ok_count
    AND t.aprovado = true
    AND (c.whatsapp_number_id IS NULL OR t.whatsapp_number_id = c.whatsapp_number_id)
    AND (c.template_modelo IS NULL OR t.nome = c.template_modelo)
  ORDER BY
    (t.whatsapp_number_id = c.whatsapp_number_id) DESC NULLS LAST,
    (t.nome = COALESCE(c.template_modelo, 'Padrão')) DESC,
    t.updated_at DESC
  LIMIT 1;

  RETURN v_tpl;
END;
$function$;