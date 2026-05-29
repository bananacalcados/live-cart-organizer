UPDATE public.group_campaign_scheduled_messages
SET status = 'cancelled',
    locked_until = NULL
WHERE message_group_id = '621d9277-937c-49d1-b8cb-93badb687d4c'
  AND status IN ('sending', 'pending', 'grouped');