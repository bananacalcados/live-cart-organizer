
-- Adicionar customer_id na tabela customer_registrations
ALTER TABLE customer_registrations ADD COLUMN customer_id uuid REFERENCES customers(id);

-- Criar indice para busca rapida por customer
CREATE INDEX idx_customer_registrations_customer_id ON customer_registrations(customer_id);

-- Funcao para buscar ultimo cadastro por customer_id
CREATE OR REPLACE FUNCTION get_latest_registration_by_customer(p_customer_id uuid)
RETURNS SETOF customer_registrations
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM customer_registrations
  WHERE customer_id = p_customer_id
  ORDER BY updated_at DESC
  LIMIT 1;
$$;
