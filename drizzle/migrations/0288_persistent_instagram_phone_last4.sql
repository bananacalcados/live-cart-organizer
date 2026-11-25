-- Persistent Instagram last-four: storage only, never proof of phone ownership.
ALTER TABLE public.customers ADD COLUMN phone_last4 text, ADD COLUMN phone_last4_updated_at timestamptz;
COMMENT ON COLUMN public.customers.phone_last4 IS 'Final informado do WhatsApp; não comprova identidade. NULL com timestamp representa limpeza manual.';
WITH latest AS (
 SELECT DISTINCT ON (customer_id) customer_id,phone_last4,updated_at
 FROM public.orders WHERE phone_last4 ~ '^[0-9]{4}$'
 ORDER BY customer_id,updated_at DESC,id DESC
)
UPDATE public.customers c SET phone_last4=l.phone_last4,phone_last4_updated_at=l.updated_at
FROM latest l WHERE c.id=l.customer_id AND c.phone_last4_updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.live_inherit_customer_last4()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.phone_last4 IS NULL THEN
  SELECT c.phone_last4 INTO NEW.phone_last4 FROM public.customers c WHERE c.id=NEW.customer_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.live_inherit_customer_last4() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_inherit_customer_last4() TO service_role;
CREATE TRIGGER trg_orders_inherit_customer_last4 BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.live_inherit_customer_last4();

CREATE OR REPLACE FUNCTION public.live_mark_last4_conflicts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
 -- Extend the existing phone-change trigger, never react to cancellation alone.
 IF TG_OP='UPDATE' THEN
  IF OLD.phone_last4 IS DISTINCT FROM NEW.phone_last4 THEN
   UPDATE public.customers SET phone_last4=NEW.phone_last4,phone_last4_updated_at=now()
   WHERE id=NEW.customer_id AND phone_last4 IS DISTINCT FROM NEW.phone_last4;
  END IF;
 ELSIF NEW.phone_last4 ~ '^[0-9]{4}$' THEN
  UPDATE public.customers SET phone_last4=NEW.phone_last4,phone_last4_updated_at=now()
  WHERE id=NEW.customer_id AND phone_last4 IS DISTINCT FROM NEW.phone_last4
    AND (phone_last4_updated_at IS NULL OR NEW.created_at>=phone_last4_updated_at);
 END IF;
 IF NEW.phone_last4 IS NULL OR NEW.event_id IS NULL OR NEW.stage='cancelled' THEN RETURN NEW; END IF;
 SELECT count(*) INTO v_count FROM public.orders o
 WHERE o.event_id=NEW.event_id AND o.phone_last4=NEW.phone_last4 AND o.stage<>'cancelled';
 IF v_count>1 THEN
  UPDATE public.orders o SET link_status='manual_required'
  WHERE o.event_id=NEW.event_id AND o.phone_last4=NEW.phone_last4 AND o.stage<>'cancelled' AND o.link_status<>'linked' AND o.link_status IS DISTINCT FROM 'manual_required';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.live_mark_last4_conflicts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_mark_last4_conflicts() TO service_role;

-- Preserve the deployed parser and its product/size logic; save genuine parsed finals
-- before no_intent, so digits-only comments also persist without an open cart.
DO $mig$
DECLARE d text; d2 text;
BEGIN
 d:=pg_get_functiondef('public.process_live_comment_codes(text,uuid,text,text)'::regprocedure);
 d2:=replace(d,'last4_prev text;', 'last4_prev text; v_customer_ids uuid[];');
 d2:=replace(d2,
 $old$  n_codes := coalesce(array_length(codes,1),0); n_sizes := coalesce(array_length(sizes,1),0);$old$,
 $new$  n_codes := coalesce(array_length(codes,1),0); n_sizes := coalesce(array_length(sizes,1),0);
  if last4 ~ '^[0-9]{4}$' then
    select array_agg(id) into v_customer_ids from (
      select id from customers where ig_handle_norm(instagram_handle)=ig_handle_norm(uname) limit 2
    ) matched;
    if coalesce(cardinality(v_customer_ids),0)=0 then
      insert into customers(instagram_handle,phone_last4,phone_last4_updated_at)
      values ('@'||uname,last4,now()) on conflict(instagram_handle) do nothing;
    elsif cardinality(v_customer_ids)=1 then
      update customers set phone_last4=last4,phone_last4_updated_at=now()
      where id=v_customer_ids[1] and phone_last4 is distinct from last4;
    end if;
  end if;$new$);
 IF d2=d OR position('v_customer_ids uuid[]' in d2)=0 OR position('values (''@''||uname,last4,now())' in d2)=0 THEN
  RAISE EXCEPTION 'Unexpected process_live_comment_codes definition';
 END IF;
 EXECUTE d2;
END $mig$;
