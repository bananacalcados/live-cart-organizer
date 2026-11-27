REVOKE ALL ON TABLE public.correios_pi_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.correios_pi_requests TO authenticated;
GRANT ALL ON TABLE public.correios_pi_requests TO service_role;