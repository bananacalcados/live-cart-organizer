-- This existing routine creates transaction-local temporary tables.
-- Preserve its body, access grants and filtering semantics; STABLE forbids that DDL.
ALTER FUNCTION public.get_reactivation_candidates(integer) VOLATILE;