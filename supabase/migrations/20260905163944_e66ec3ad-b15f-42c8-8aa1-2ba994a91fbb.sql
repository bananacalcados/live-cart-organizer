ALTER PUBLICATION supabase_realtime ADD TABLE public.live_whatsapp_clicks;

CREATE OR REPLACE FUNCTION public.mark_orders_unread_on_incoming()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suffix text;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'incoming' THEN RETURN NEW; END IF;
  IF NEW.message IS NOT NULL AND left(NEW.message, 12) = '💬 Comentário' THEN RETURN NEW; END IF;
  IF NEW.phone IS NULL OR NEW.phone LIKE '%@g.us' THEN RETURN NEW; END IF;
  v_suffix := right(regexp_replace(NEW.phone, '\D', '', 'g'), 8);
  IF length(v_suffix) < 8 THEN RETURN NEW; END IF;

  UPDATE orders o
     SET has_unread_messages = true,
         last_customer_message_at = COALESCE(NEW.created_at, now())
    FROM customers c
    JOIN events e ON e.is_active = true
   WHERE o.customer_id = c.id
     AND o.event_id = e.id
     AND right(regexp_replace(COALESCE(c.whatsapp, ''), '\D', '', 'g'), 8) = v_suffix
     AND o.stage <> 'shipped'
     AND o.has_unread_messages IS DISTINCT FROM true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_orders_unread_on_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_mark_orders_unread_on_incoming
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.mark_orders_unread_on_incoming();