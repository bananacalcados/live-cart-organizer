\set ON_ERROR_STOP on
-- Only via runLiveShownReappear.sh, in an isolated disposable cluster.
BEGIN;
\ir fixtures/liveShownReappear.sql
\ir ../../docs/database/20261114170800_live_shown_represent.sql
DO $$
DECLARE
  test_event uuid := gen_random_uuid();
  token uuid := gen_random_uuid();
  first_id uuid;
  product public.live_shown_products;
  overlay jsonb;
BEGIN
  INSERT INTO public.events(id, overlay_token) VALUES (test_event, token);
  SELECT * INTO product FROM public.set_live_shown_product(test_event, 'TEST-REAPPEAR', 'Test', 'manual');
  first_id := product.id;
  IF product.is_current IS DISTINCT FROM true OR product.stopped_at IS NOT NULL THEN
    RAISE EXCEPTION 'First presentation must be current and not stopped';
  END IF;
  PERFORM public.stop_live_shown_product(test_event);
  SELECT * INTO STRICT product FROM public.live_shown_products WHERE id = first_id;
  IF product.is_current IS DISTINCT FROM false OR product.stopped_at IS NULL THEN
    RAISE EXCEPTION 'Stop must set stopped_at and clear is_current';
  END IF;
  overlay := public.overlay_shown_products(token);
  IF overlay->'current' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Stopped product must not appear in overlay current';
  END IF;
  SELECT * INTO product FROM public.set_live_shown_product(test_event, 'TEST-REAPPEAR', NULL, 'manual');
  SELECT * INTO STRICT product FROM public.live_shown_products WHERE id = first_id;
  IF product.is_current IS DISTINCT FROM true OR product.stopped_at IS NOT NULL THEN
    RAISE EXCEPTION 'Re-presenting must persist is_current=true and stopped_at=NULL';
  END IF;
  IF (SELECT count(*) FROM public.live_shown_products WHERE event_id = test_event) <> 1 THEN
    RAISE EXCEPTION 'Re-presenting must reuse the existing row';
  END IF;
  overlay := public.overlay_shown_products(token);
  IF overlay #>> '{current,code}' IS DISTINCT FROM 'TEST-REAPPEAR' THEN
    RAISE EXCEPTION 'Re-presented product must appear in overlay current: %', overlay;
  END IF;
  RAISE NOTICE 'PASS: present -> stop -> present; stored current=true/stopped_at=NULL; overlay current restored';
END $$;
ROLLBACK;
DO $$ BEGIN
  IF to_regclass('public.live_shown_products') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback must remove all synthetic fixtures';
  END IF;
END $$;