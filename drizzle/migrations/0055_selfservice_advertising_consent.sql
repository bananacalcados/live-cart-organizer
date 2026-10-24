CREATE TABLE public.selfservice_advertising_consents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), advertising boolean NOT NULL DEFAULT false, region text, notice_version text NOT NULL, choices_history jsonb NOT NULL DEFAULT '[]'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.selfservice_advertising_consents TO service_role;
ALTER TABLE public.selfservice_advertising_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.selfservice_advertising_consents FROM anon,authenticated;
ALTER TABLE public.live_selfservice_accesses ADD COLUMN advertising_consent_id uuid, ADD COLUMN advertising_snapshot jsonb, ADD COLUMN advertising_signals jsonb;
ALTER TABLE public.customer_registrations ADD COLUMN selfservice_advertising_consent_id uuid, ADD COLUMN selfservice_advertising_snapshot jsonb;
CREATE OR REPLACE FUNCTION public.selfservice_save_advertising_choice(p_id uuid,p_accept boolean,p_region text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; choice jsonb;
BEGIN
 choice:=jsonb_build_object('advertising',p_accept,'recorded_at',clock_timestamp(),'region',p_region,'notice_version','selfservice-meta-v1','data','name,email,phone,city,state,zip,internal_id,ip,user_agent,fbp,fbc,purchase','recipient','Meta','purposes','advertising_measurement,ad_optimization');
 IF p_id IS NULL THEN
  INSERT INTO public.selfservice_advertising_consents(advertising,region,notice_version,choices_history) VALUES(p_accept,p_region,'selfservice-meta-v1',jsonb_build_array(choice)) RETURNING id INTO v_id;
 ELSE
  UPDATE public.selfservice_advertising_consents SET advertising=p_accept,region=p_region,choices_history=choices_history||jsonb_build_array(choice),updated_at=clock_timestamp() WHERE id=p_id AND advertising IS DISTINCT FROM p_accept RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM public.selfservice_advertising_consents WHERE id=p_id; END IF;
 END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.selfservice_save_advertising_choice(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_save_advertising_choice(uuid,boolean,text) TO service_role;