-- Add indexes to large tables to fix statement timeouts

-- whatsapp_messages (75k rows)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON public.whatsapp_messages (phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_created ON public.whatsapp_messages (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON public.whatsapp_messages (status) WHERE status IN ('sending', 'sent', 'delivered');

-- marketing_contacts (75k rows)
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_phone ON public.marketing_contacts (phone);

-- automation_pending_replies (24k rows)
CREATE INDEX IF NOT EXISTS idx_automation_pending_phone ON public.automation_pending_replies (phone);
CREATE INDEX IF NOT EXISTS idx_automation_pending_created ON public.automation_pending_replies (created_at DESC);

-- automation_dispatch_sent (22k rows) - index on flow_id and phone
CREATE INDEX IF NOT EXISTS idx_automation_dispatch_flow ON public.automation_dispatch_sent (flow_id);
CREATE INDEX IF NOT EXISTS idx_automation_dispatch_phone ON public.automation_dispatch_sent (phone);

-- chat_contacts (3k rows)
CREATE INDEX IF NOT EXISTS idx_chat_contacts_phone ON public.chat_contacts (phone);

-- user_roles - used by has_role RPC on every page load
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role ON public.user_roles (user_id, role);

-- user_module_permissions - used by has_module_access RPC on every page load
CREATE INDEX IF NOT EXISTS idx_user_module_perms_user ON public.user_module_permissions (user_id, module);