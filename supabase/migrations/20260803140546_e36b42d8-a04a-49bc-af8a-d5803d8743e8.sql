ALTER TABLE public.pos_commission_people
  ADD COLUMN IF NOT EXISTS base_salary numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS role_bonus_percent numeric NOT NULL DEFAULT 0;