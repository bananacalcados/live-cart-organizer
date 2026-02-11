
ALTER TABLE public.expedition_orders
  ADD COLUMN is_from_live boolean NOT NULL DEFAULT false,
  ADD COLUMN source_event_name text,
  ADD COLUMN source_event_date timestamp with time zone,
  ADD COLUMN has_gift boolean NOT NULL DEFAULT false;
