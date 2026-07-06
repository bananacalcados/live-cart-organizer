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
  -- BLINDAGEM: só espelha para o CRM contatos com TELEFONE REAL (BR).
  -- Um telefone BR normalizado tem no máximo 13 dígitos (55 + DDD + número).
  -- Qualquer coisa acima disso NÃO é telefone — é identidade não-cliente:
  --   • Grupo de WhatsApp: JID com 18+ dígitos (geralmente "120363...").
  --   • Instagram/Messenger: ID de 15-17 dígitos.
  --   • LID não resolvido: 14 dígitos (pessoa real, mas sem telefone válido).
  -- Todos continuam em chat_contacts (lista de conversas), mas não viram cliente.
  IF v_digits = '' OR length(v_digits) > 13
     OR EXISTS (
          SELECT 1 FROM whatsapp_groups g
           WHERE regexp_replace(g.group_id, '\D', '', 'g') = v_digits
        )
  THEN
    RETURN NEW;
  END IF;

  v_id := find_or_create_unified_customer(
    p_phone  => NEW.phone,
    p_name   => COALESCE(NEW.custom_name, NEW.display_name),
    p_source => 'chat:' || NEW.id::text
  );
  RETURN NEW;
END $function$;