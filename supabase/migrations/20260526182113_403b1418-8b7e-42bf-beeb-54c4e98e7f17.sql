ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS initial_message_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS initial_message_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.events.initial_message_enabled IS 'Quando true, livete-start-order envia os blocos configurados em initial_message_blocks ao invés dos blocos default. A IA continua sendo usada apenas para follow-up.';
COMMENT ON COLUMN public.events.initial_message_blocks IS 'Array de strings. Cada string é um balão (bloco) enviado em sequência com delay humanizado. Suporta variáveis: {customer_first_name}, {customer_name}, {instagram}, {products}, {products_short}, {subtotal}, {discount}, {total}, {order_id}, {checkout_link}.';