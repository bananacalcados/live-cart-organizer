CREATE INDEX IF NOT EXISTS idx_instagram_comment_actions_user_cooldown
ON public.instagram_comment_actions (rule_id, action_type, created_at DESC, comment_id)
WHERE action_type = 'user_cooldown';