-- Add column to track which groups have already been sent
ALTER TABLE group_campaign_scheduled_messages 
ADD COLUMN IF NOT EXISTS sent_group_ids uuid[] DEFAULT '{}';

-- Cancel all stuck 'sending' messages
UPDATE group_campaign_scheduled_messages 
SET status = 'failed' 
WHERE status = 'sending';