GRANT EXECUTE ON FUNCTION public.selfservice_queue_enqueue(text, uuid, uuid, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.selfservice_instance_gate(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_requeue(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_requeue(uuid) TO authenticated;