UPDATE public.fiscal_documents
SET danfe_url = 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/fiscal-render-document?url=' ||
  replace(replace(replace(replace(replace(danfe_url, '%', '%25'), ':', '%3A'), '/', '%2F'), '?', '%3F'), '&', '%26')
WHERE danfe_url IS NOT NULL
  AND danfe_url ~* '\.html($|\?)'
  AND danfe_url NOT LIKE 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/fiscal-render-document?%';

UPDATE public.nfe_received
SET danfe_url = 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/fiscal-render-document?url=' ||
  replace(replace(replace(replace(replace(danfe_url, '%', '%25'), ':', '%3A'), '/', '%2F'), '?', '%3F'), '&', '%26')
WHERE danfe_url IS NOT NULL
  AND danfe_url ~* '\.html($|\?)'
  AND danfe_url NOT LIKE 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/fiscal-render-document?%';