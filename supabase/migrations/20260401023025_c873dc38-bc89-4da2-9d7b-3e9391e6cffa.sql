
-- Table for Instagram comment automation rules
CREATE TABLE public.instagram_comment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  trigger_type TEXT NOT NULL DEFAULT 'keyword', -- keyword, all, media_type
  trigger_keywords TEXT[] DEFAULT '{}',
  media_types TEXT[] DEFAULT '{post,REELS}', -- post, REELS, IGTV
  action_reply_comment BOOLEAN DEFAULT false,
  reply_comment_text TEXT,
  action_send_dm BOOLEAN DEFAULT false,
  dm_message_text TEXT,
  action_trigger_automation BOOLEAN DEFAULT false,
  automation_flow_id UUID REFERENCES public.automation_flows(id) ON DELETE SET NULL,
  cooldown_minutes INTEGER DEFAULT 60,
  ai_generate_reply BOOLEAN DEFAULT false,
  ai_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.instagram_comment_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage instagram comment rules"
  ON public.instagram_comment_rules
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Track which comments we already processed to avoid duplicate actions
CREATE TABLE public.instagram_comment_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id TEXT NOT NULL,
  rule_id UUID REFERENCES public.instagram_comment_rules(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- reply, dm, automation
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(comment_id, rule_id, action_type)
);

ALTER TABLE public.instagram_comment_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view instagram comment actions"
  ON public.instagram_comment_actions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
