UPDATE public.products_master SET ncm = '64039990' WHERE regexp_replace(ncm,'\D','','g') = '64039900';
UPDATE public.products_master SET ncm = '64029990' WHERE regexp_replace(ncm,'\D','','g') = '64029900';
UPDATE public.fiscal_documents SET status = 'rejected', rejection_message = 'Falha de comunicacao com o emissor (522). Reemita a nota.' WHERE id = 'b0eb7ce6-b81c-4126-8271-97d3aeb55db9';