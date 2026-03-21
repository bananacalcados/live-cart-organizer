ALTER TABLE group_campaign_scheduled_messages 
  ADD COLUMN IF NOT EXISTS message_group_id uuid,
  ADD COLUMN IF NOT EXISTS block_order integer DEFAULT 0;