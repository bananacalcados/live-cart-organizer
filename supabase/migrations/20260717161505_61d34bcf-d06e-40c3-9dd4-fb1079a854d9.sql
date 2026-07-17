UPDATE public.companies
SET address_cep='35051520', address_street='Rua Vale Formoso', address_number='362',
    address_neighborhood='Kennedy', address_city='Governador Valadares',
    address_city_ibge='3127701', address_state='MG', address_country=COALESCE(address_country,'BR')
WHERE address_cep IS NULL OR address_state IS NULL;