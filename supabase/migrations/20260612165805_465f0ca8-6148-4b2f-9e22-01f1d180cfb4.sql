ALTER TABLE public.pos_sellers ADD COLUMN IF NOT EXISTS excluded_from_tasks boolean NOT NULL DEFAULT false;

UPDATE public.pos_sellers
SET excluded_from_tasks = true
WHERE id IN ('bec7d0b3-a1fd-4611-a165-6cd49f185a0a', '1a8c4537-d28f-4858-a20b-3e3f03d169a5');

DELETE FROM public.pos_seller_task_instances
WHERE seller_id IN ('bec7d0b3-a1fd-4611-a165-6cd49f185a0a', '1a8c4537-d28f-4858-a20b-3e3f03d169a5');