
-- Secretary AI reminders table
CREATE TABLE public.secretary_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  reminder_type TEXT NOT NULL DEFAULT 'one_time', -- one_time, weekly, daily
  due_date TIMESTAMPTZ,
  remind_at TIMESTAMPTZ,
  phone TEXT NOT NULL, -- phone to send WhatsApp reminder
  whatsapp_number_id UUID, -- which instance to send from
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  last_reminded_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.secretary_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage reminders"
ON public.secretary_reminders FOR ALL TO authenticated
USING (true) WITH CHECK (true);

-- Secretary chat messages table
CREATE TABLE public.secretary_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- user, assistant
  content TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.secretary_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage secretary messages"
ON public.secretary_messages FOR ALL TO authenticated
USING (true) WITH CHECK (true);

-- Secretary settings
CREATE TABLE public.secretary_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  reminder_phone TEXT, -- admin's phone for reminders
  whatsapp_number_id UUID, -- which instance to use
  weekly_reminder_day INTEGER DEFAULT 1, -- 0=Sun, 1=Mon...
  weekly_reminder_hour INTEGER DEFAULT 8, -- hour of day
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.secretary_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage secretary settings"
ON public.secretary_settings FOR ALL TO authenticated
USING (true) WITH CHECK (true);
