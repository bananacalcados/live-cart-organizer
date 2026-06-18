-- Remover leitura pública (não autenticada) das três tabelas internas.
-- A política "Authenticated manage ..." (ALL para authenticated) permanece,
-- então a equipe logada continua lendo/gravando normalmente.
-- Edge functions usam service_role e ignoram RLS, então continuam funcionando.

DROP POLICY IF EXISTS "Anyone can view delivery costs" ON public.delivery_costs;
DROP POLICY IF EXISTS "Anyone can view provider payments" ON public.provider_payments;
DROP POLICY IF EXISTS "Anyone can view providers" ON public.service_providers;

-- Revogar GRANT de SELECT do papel anônimo (sem login), caso exista,
-- para que a Data API não consiga ler mesmo sem política.
REVOKE SELECT ON public.delivery_costs FROM anon;
REVOKE SELECT ON public.provider_payments FROM anon;
REVOKE SELECT ON public.service_providers FROM anon;