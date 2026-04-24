
-- Configura o service role key no DB pra ser usado pelo trigger
-- (chave já está disponível como secret SUPABASE_SERVICE_ROLE_KEY nas edge functions)
DO $$
DECLARE
  v_key text;
BEGIN
  -- Tenta ler do vault primeiro (se existir)
  BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;

  -- Se não tiver no vault, deixamos a config vazia (a edge function vai logar o erro)
  IF v_key IS NOT NULL THEN
    EXECUTE format('ALTER DATABASE postgres SET app.settings.service_role_key = %L', v_key);
  END IF;
END $$;
