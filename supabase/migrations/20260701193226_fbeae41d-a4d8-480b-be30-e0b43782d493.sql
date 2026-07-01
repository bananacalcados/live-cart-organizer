CREATE OR REPLACE FUNCTION public.sync_variant_to_pos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF is_sync_in_progress() THEN RETURN NEW; END IF;
  IF NEW.last_sync_source = 'pos' THEN
    NEW.last_sync_source := NULL;
    RETURN NEW;
  END IF;

  PERFORM set_config('app.sync_in_progress', 'on', true);

  -- Atualiza TODAS as linhas de pos_products que representam esta variação
  -- em TODAS as lojas. Antes, quando havia tiny_variant_id, apenas UMA linha
  -- (a de tiny_id correspondente) era casada, deixando as demais lojas com o
  -- barcode antigo. Como o estoque do Legacy é somado por barcode entre lojas,
  -- trocar o GTIN "zerava" a variação (as linhas com estoque ficavam órfãs do
  -- barcode novo). Agora também casamos pelo barcode/sku ANTIGO para manter o
  -- vínculo do estoque em todas as lojas.
  UPDATE pos_products pp SET
    color      = COALESCE(NEW.color, pp.color),
    size       = COALESCE(NEW.size,  pp.size),
    sku        = COALESCE(NEW.sku,   pp.sku),
    barcode    = COALESCE(NEW.gtin,  pp.barcode),
    updated_at = now()
  WHERE
    (NEW.tiny_variant_id IS NOT NULL AND pp.tiny_id::text = NEW.tiny_variant_id)
    OR (OLD.gtin IS NOT NULL AND OLD.gtin <> '' AND pp.barcode = OLD.gtin)
    OR (OLD.sku  IS NOT NULL AND OLD.sku  <> '' AND pp.sku     = OLD.sku);

  PERFORM set_config('app.sync_in_progress', 'off', true);
  RETURN NEW;
END;
$function$;