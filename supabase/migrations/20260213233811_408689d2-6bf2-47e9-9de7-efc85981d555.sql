
-- Add unique constraint on phone for upsert support
ALTER TABLE public.automation_ai_sessions ADD CONSTRAINT automation_ai_sessions_phone_unique UNIQUE (phone);
