-- 1) Função que cria assignment quando IA abre ticket
CREATE OR REPLACE FUNCTION public.auto_assign_chat_from_support_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só processa tickets criados por IA com telefone do cliente
  IF NEW.customer_phone IS NULL OR NEW.customer_phone = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.source IS NULL OR NEW.source NOT IN ('bia_ai', 'jess_ai', 'ai_concierge', 'ai_assistant', 'livete_ai') THEN
    RETURN NEW;
  END IF;

  -- Evita duplicar: se já existe assignment pendente pra esse telefone, atualiza notes
  IF EXISTS (
    SELECT 1 FROM public.chat_assignments
    WHERE phone = NEW.customer_phone
      AND assigned_by = 'ai'
      AND status = 'pending'
  ) THEN
    UPDATE public.chat_assignments
    SET notes = COALESCE(notes, '') || E'\n— ' || COALESCE(NEW.subject, 'Novo ticket'),
        updated_at = now()
    WHERE phone = NEW.customer_phone
      AND assigned_by = 'ai'
      AND status = 'pending';
    RETURN NEW;
  END IF;

  INSERT INTO public.chat_assignments (
    phone, assigned_by, status, ai_classification, notes
  ) VALUES (
    NEW.customer_phone,
    'ai',
    'pending',
    NEW.subject,
    NEW.description
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[auto_assign_chat_from_support_ticket] error: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 2) Trigger
DROP TRIGGER IF EXISTS trg_auto_assign_chat_from_support_ticket ON public.support_tickets;
CREATE TRIGGER trg_auto_assign_chat_from_support_ticket
AFTER INSERT ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_chat_from_support_ticket();

-- 3) Backfill dos últimos 30 dias para tickets de IA sem assignment pendente
INSERT INTO public.chat_assignments (phone, assigned_by, status, ai_classification, notes, created_at)
SELECT DISTINCT ON (st.customer_phone)
  st.customer_phone,
  'ai',
  'pending',
  st.subject,
  st.description,
  st.created_at
FROM public.support_tickets st
WHERE st.created_at >= now() - interval '30 days'
  AND st.customer_phone IS NOT NULL
  AND st.customer_phone != ''
  AND st.source IN ('bia_ai', 'jess_ai', 'ai_concierge', 'ai_assistant', 'livete_ai')
  AND st.status NOT IN ('resolved', 'cancelled', 'closed')
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_assignments ca
    WHERE ca.phone = st.customer_phone
      AND ca.assigned_by = 'ai'
      AND ca.status = 'pending'
  )
ORDER BY st.customer_phone, st.created_at DESC;