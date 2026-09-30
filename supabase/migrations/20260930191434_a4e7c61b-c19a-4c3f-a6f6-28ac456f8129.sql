REVOKE ALL ON FUNCTION public.participant_score_ranking(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.participant_score_ranking(text[]) TO authenticated, service_role;