ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS auto_resumed_at timestamptz;
CREATE OR REPLACE FUNCTION public.support_settings_mark_auto_resume() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.auto_reply_mode='auto' AND OLD.auto_reply_mode IS DISTINCT FROM 'auto' THEN NEW.auto_resumed_at := now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_support_settings_mark_auto_resume ON public.support_settings;
CREATE TRIGGER trg_support_settings_mark_auto_resume BEFORE UPDATE OF auto_reply_mode ON public.support_settings
FOR EACH ROW WHEN (OLD.auto_reply_mode IS DISTINCT FROM NEW.auto_reply_mode) EXECUTE FUNCTION public.support_settings_mark_auto_resume();

CREATE OR REPLACE FUNCTION public.support_ai_failure_watchdog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tot int; bad int; since timestamptz;
BEGIN
  IF NEW.kind<>'triagem' THEN RETURN NEW; END IF;
  SELECT greatest(now()-interval '30 minutes', coalesce(auto_resumed_at,'epoch'::timestamptz)) INTO since FROM public.support_settings WHERE auto_reply_mode='auto';
  IF since IS NULL THEN RETURN NEW; END IF;
  WITH s AS (
    SELECT suggestion_id, bool_or(ok) AS any_ok, max(attempt) AS max_att, min(created_at) AS first_at
    FROM public.support_ai_attempts WHERE kind='triagem' AND created_at>since GROUP BY suggestion_id)
  SELECT count(*) FILTER (WHERE any_ok OR max_att>=2 OR first_at<now()-interval '1 minute'),
         count(*) FILTER (WHERE NOT any_ok AND (max_att>=2 OR first_at<now()-interval '1 minute'))
    INTO tot, bad FROM s;
  IF tot>=4 AND bad*2>tot THEN
    UPDATE public.support_settings SET auto_reply_mode='shadow',
      ai_pause_reason=left(format('IA do suporte com %s de %s triagens falhando em 30 min (>50%%). Voltou para sombra automaticamente.',bad,tot),500),
      ai_pause_until=NULL, updated_at=now()
    WHERE auto_reply_mode='auto';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.support_ai_failure_watchdog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_settings_mark_auto_resume() FROM PUBLIC, anon, authenticated;