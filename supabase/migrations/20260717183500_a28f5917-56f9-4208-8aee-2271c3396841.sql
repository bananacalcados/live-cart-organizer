
ALTER TABLE public.chat_finished_conversations
  ADD COLUMN IF NOT EXISTS purchased boolean,
  ADD COLUMN IF NOT EXISTS support_reason text,
  ADD COLUMN IF NOT EXISTS support_satisfactory boolean,
  ADD COLUMN IF NOT EXISTS duvida_text text;
