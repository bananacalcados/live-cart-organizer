
-- Add message_type and metadata to team_chat_messages for action messages
ALTER TABLE public.team_chat_messages
ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text',
ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Add comment
COMMENT ON COLUMN public.team_chat_messages.message_type IS 'text, transfer_request, support_ticket, task';
COMMENT ON COLUMN public.team_chat_messages.metadata IS 'Extra data for action messages (product info, ticket details, etc)';
