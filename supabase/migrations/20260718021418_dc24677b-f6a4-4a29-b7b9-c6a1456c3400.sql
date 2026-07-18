
DO $$
DECLARE
  keeper uuid := 'b0554779-f654-43d7-bb61-3005658e8c9e';
  dup uuid := 'fd9a879f-bd39-40f2-ad4b-5690a7d6ee0d';
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'ai_assistance_requests','chat_finished_conversations','chat_nps_surveys','chat_payment_followups',
    'chat_seller_assignments','link_page_leads','link_page_visits','link_pages',
    'pos_cash_movements','pos_cash_registers','pos_conditionals','pos_exchanges','pos_gamification',
    'pos_goal_progress','pos_goals','pos_returns','pos_sales','pos_seller_commissions',
    'pos_seller_task_instances','pos_seller_tasks','pos_site_exchanges','pos_stock_adjustments',
    'trigger_conversions','user_profiles'
  ]) LOOP
    EXECUTE format('UPDATE public.%I SET seller_id=%L::uuid WHERE seller_id::text=%L', t, keeper, dup::text);
  END LOOP;

  BEGIN
    UPDATE public.pos_commission_people_sellers SET seller_id=keeper WHERE seller_id::text=dup::text;
  EXCEPTION WHEN unique_violation THEN
    DELETE FROM public.pos_commission_people_sellers WHERE seller_id::text=dup::text;
  END;
  BEGIN
    UPDATE public.pos_store_sellers SET seller_id=keeper::text WHERE seller_id::text=dup::text;
  EXCEPTION WHEN unique_violation THEN
    DELETE FROM public.pos_store_sellers WHERE seller_id::text=dup::text;
  END;

  DELETE FROM public.pos_sellers WHERE id=dup;
END $$;
