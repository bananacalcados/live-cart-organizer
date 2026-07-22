UPDATE public.templates_carrossel
SET meta_status = 'APPROVED', aprovado = true, updated_at = now()
WHERE template_id = 'evento_carrossel_crossel_live1_3cards'
  AND meta_status <> 'APPROVED';