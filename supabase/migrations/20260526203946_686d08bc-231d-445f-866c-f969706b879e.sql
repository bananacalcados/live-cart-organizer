UPDATE public.events
SET automation_enabled = true
WHERE automation_enabled = false
  AND (
    (meta_template_name IS NOT NULL AND meta_template_name <> '')
    OR initial_message_enabled = true
  );