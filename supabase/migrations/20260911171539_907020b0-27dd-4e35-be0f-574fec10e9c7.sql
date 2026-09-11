DROP FUNCTION IF EXISTS public.reopen_finished_conversation(text);

REVOKE ALL ON FUNCTION public.reopen_finished_conversation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_finished_conversation(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_finished_conversation(text, uuid) TO service_role;