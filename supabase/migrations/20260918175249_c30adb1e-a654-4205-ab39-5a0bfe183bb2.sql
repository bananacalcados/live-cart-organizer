CREATE OR REPLACE FUNCTION public.trg_pos_sale_completed_automation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/automation-trigger-pos-sale';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk';
  v_ok boolean;
BEGIN
  v_ok := NEW.status IN ('completed','paid','pending_pickup')
    AND COALESCE(NEW.sale_type,'physical') IN ('physical','online','live')
    AND COALESCE(NEW.status_cancelamento::text,'ativo') = 'ativo'
    AND (TG_OP = 'INSERT' OR COALESCE(OLD.status,'') NOT IN ('completed','paid','pending_pickup'));

  IF v_ok THEN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','apikey',v_anon,'Authorization','Bearer '||v_anon),
      body := jsonb_build_object('sale_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$function$;