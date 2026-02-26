
-- Add is_simulation flag to pos_stores
ALTER TABLE public.pos_stores ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false;

-- Simulation stores don't need tiny_token, so make it nullable if not already
ALTER TABLE public.pos_stores ALTER COLUMN tiny_token DROP NOT NULL;
