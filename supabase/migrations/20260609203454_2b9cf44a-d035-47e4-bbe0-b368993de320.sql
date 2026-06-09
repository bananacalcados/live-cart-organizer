CREATE OR REPLACE FUNCTION public.notify_wa_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime
AS $$
BEGIN
  -- Skip realtime broadcast for mass-dispatch outgoing rows. A single dispatch
  -- inserts thousands of these; broadcasting each one made every connected client
  -- re-run the heavy get_conversations query, saturating DB CPU/RAM ("dispatch storm").
  -- These rows do NOT need to appear as a live conversation update. When the client
  -- actually REPLIES, that incoming message (is_mass_dispatch = false) DOES broadcast,
  -- so the conversation surfaces normally for the team to answer.
  IF COALESCE(NEW.is_mass_dispatch, false) = true THEN
    RETURN NEW;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'phone', NEW.phone,
      'whatsapp_number_id', NEW.whatsapp_number_id,
      'direction', NEW.direction,
      'created_at', NEW.created_at
    ),
    'wa_msg_insert',     -- event name
    'wa_msg_inserts',    -- topic / channel
    false                -- private = false (public broadcast)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block inserts if broadcast fails
  RETURN NEW;
END;
$$;