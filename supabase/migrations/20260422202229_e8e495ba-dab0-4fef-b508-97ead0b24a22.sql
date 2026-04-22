UPDATE public.campaign_landing_pages
SET 
  form_fields = '[{"name":"nome","type":"text","label":"Nome","required":true},{"name":"whatsapp","type":"tel","label":"WhatsApp","required":true}]'::jsonb,
  description = E'Estaremos AO VIVO nesse Sábado a partir das 15h! A Live é o lugar ideal pra você nos conhecer, tirar suas dúvidas, e realizar suas compras sem medo de errar na Compra online!\n\n🇧🇷 Enviamos pra todo o Brasil\n🚚 FRETE GRÁTIS pro Sudeste\nOPÇÕES DE R$ 99,99 A R$ 299,99',
  hero_image_url = 'https://tqxhcyuxgqbzqwoidpie.supabase.co/storage/v1/object/public/marketing-attachments/lp/lancabril2026-bg.jpg',
  updated_at = now()
WHERE slug = 'lancabril2026';