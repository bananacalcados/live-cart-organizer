ALTER TABLE public.whatsapp_numbers ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE public.whatsapp_numbers ALTER COLUMN access_token DROP NOT NULL;
ALTER TABLE public.whatsapp_numbers ALTER COLUMN business_account_id DROP NOT NULL;