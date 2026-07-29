
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS operation_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS member_area_slug text;

CREATE UNIQUE INDEX IF NOT EXISTS events_member_area_slug_key
  ON public.events (member_area_slug) WHERE member_area_slug IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_window_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS public.live_member_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  otp_verified_until timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_member_sessions_phone_idx ON public.live_member_sessions (phone);

GRANT ALL ON public.live_member_sessions TO service_role;
ALTER TABLE public.live_member_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "member sessions service only" ON public.live_member_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.expire_live_payment_windows()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.orders
     SET stage = 'awaiting_confirmation',
         payment_window_expires_at = NULL,
         customer_confirmed_at = NULL
   WHERE stage = 'awaiting_payment'
     AND COALESCE(is_paid, false) = false
     AND payment_window_expires_at IS NOT NULL
     AND payment_window_expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
