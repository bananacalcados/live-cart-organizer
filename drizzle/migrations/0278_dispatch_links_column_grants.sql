REVOKE SELECT ON public.dispatch_links FROM authenticated;
GRANT SELECT (id, code, name, description, password_version, allowed_instance_ids, template_mode, allowed_templates, allowed_audiences, allowed_comm_types, allow_send_now, allow_schedule, max_recipients, expires_at, is_active, revoked_at, simulate_only, created_by, created_at, updated_at) ON public.dispatch_links TO authenticated;
REVOKE SELECT ON public.dispatch_link_sessions FROM authenticated;
GRANT SELECT (id, link_id, password_version, ip, expires_at, revoked_at, created_at) ON public.dispatch_link_sessions TO authenticated;