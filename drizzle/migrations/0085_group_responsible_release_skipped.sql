DROP TRIGGER IF EXISTS trg_group_responsible_release_admin ON public.group_admin_actions;
CREATE TRIGGER trg_group_responsible_release_admin AFTER UPDATE ON public.group_admin_actions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('done','failed','cancelled','skipped'))
  EXECUTE FUNCTION public.trg_group_responsible_release();