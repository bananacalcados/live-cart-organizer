CREATE OR REPLACE FUNCTION public.mark_lead_as_paid(p_whatsapp TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_whatsapp_sem_ddi TEXT;
    v_whatsapp_com_ddi TEXT;
BEGIN
    v_whatsapp_com_ddi := CASE 
        WHEN p_whatsapp LIKE '55%' THEN p_whatsapp 
        ELSE '55' || p_whatsapp 
    END;
    v_whatsapp_sem_ddi := CASE 
        WHEN p_whatsapp LIKE '55%' THEN substring(p_whatsapp from 3) 
        ELSE p_whatsapp 
    END;

    UPDATE catalog_lead_registrations
    SET status = 'paid'
    WHERE whatsapp IN (v_whatsapp_com_ddi, v_whatsapp_sem_ddi)
    AND status IN ('browsing', 'checkout_started');

    UPDATE lp_leads
    SET converted = true
    WHERE phone IN (v_whatsapp_com_ddi, v_whatsapp_sem_ddi)
    AND converted = false;
END;
$$;