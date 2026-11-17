WITH bad AS (
  SELECT id FROM public.pos_sales
   WHERE tracking_url ~* '/JAD/' AND tracking_carrier ~* 'correios'
     AND tracking_code !~ '^[A-Z]{2}[0-9]{9}[A-Z]{2}$'
)
UPDATE public.pos_sales s SET tracking_carrier = 'Jadlog'
  FROM bad WHERE s.id = bad.id AND s.tracking_carrier IS DISTINCT FROM 'Jadlog';

UPDATE public.shipment_simulations z
   SET real_carrier = 'Jadlog', real_service_code = NULL
 WHERE z.real_tracking_code IN (
   SELECT tracking_code FROM public.pos_sales WHERE tracking_url ~* '/JAD/' AND tracking_carrier = 'Jadlog' AND tracking_code IS NOT NULL)
   AND z.real_carrier ~* 'correios';