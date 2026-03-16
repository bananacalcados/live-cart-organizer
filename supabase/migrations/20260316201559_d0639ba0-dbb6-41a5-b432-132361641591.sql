DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_registrations'
      AND policyname = 'Public update customer_registrations for checkout'
  ) THEN
    CREATE POLICY "Public update customer_registrations for checkout"
    ON public.customer_registrations
    FOR UPDATE
    TO anon, authenticated
    USING (
      order_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.id = customer_registrations.order_id
          AND COALESCE(o.is_paid, false) = false
      )
    )
    WITH CHECK (
      order_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.id = customer_registrations.order_id
          AND COALESCE(o.is_paid, false) = false
      )
    );
  END IF;
END
$$;