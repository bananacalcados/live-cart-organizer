CREATE OR REPLACE FUNCTION public.mirror_chat_contacts_to_unified()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id     uuid;
  v_digits text := regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g');
BEGIN
  -- BLINDAGEM DE GRUPOS: um contato que é, na verdade, um GRUPO de WhatsApp
  -- (JID de grupo) NÃO deve virar cliente no CRM. Grupos continuam existindo
  -- em chat_contacts (para a lista de conversas), mas não são espelhados.
  --   • JID novo de grupo: 18+ dígitos, geralmente começando com "120363".
  --   • JID antigo (<phone>-<timestamp>): 20+ dígitos.
  --   • Também casa com grupos já cadastrados em whatsapp_groups.
  IF v_digits <> '' AND (
       length(v_digits) >= 18
       OR left(v_digits, 6) = '120363'
       OR EXISTS (
            SELECT 1 FROM whatsapp_groups g
             WHERE regexp_replace(g.group_id, '\D', '', 'g') = v_digits
          )
     ) THEN
    RETURN NEW; -- é grupo → não espelha para o CRM
  END IF;

  v_id := find_or_create_unified_customer(
    p_phone  => NEW.phone,
    p_name   => COALESCE(NEW.custom_name, NEW.display_name),
    p_source => 'chat:' || NEW.id::text
  );
  RETURN NEW;
END $function$;