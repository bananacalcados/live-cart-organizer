GRANT EXECUTE ON FUNCTION public.selfservice_queue_enqueue(text, uuid, uuid, text, text, uuid, jsonb) TO sandbox_exec;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_claim(integer) TO sandbox_exec;
GRANT EXECUTE ON FUNCTION public.selfservice_instance_gate(text, integer) TO sandbox_exec;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_requeue(uuid) TO sandbox_exec;