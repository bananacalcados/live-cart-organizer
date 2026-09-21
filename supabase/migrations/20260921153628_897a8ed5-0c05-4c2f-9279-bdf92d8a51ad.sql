UPDATE public.pos_sale_items
SET expedition_picked_qty = 0
WHERE id IN (
  '581dd127-52dc-4a5e-8174-70245ab18078'::uuid,
  'cfbbe80c-7f4c-46d2-ad97-d4c38aac1ffe'::uuid
);

UPDATE public.pos_sales
SET expedition_stage = 'separacao',
    expedition_waiting_products = false
WHERE id IN (
  'cb1c643c-6918-4acf-b120-ec9ab3b7c176'::uuid,
  '070e6602-89d7-4598-9fff-16d085bb04a1'::uuid
);