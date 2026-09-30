
REVOKE EXECUTE ON FUNCTION public.resolve_meta_template_category(text,uuid,text), public.dispatch_unit_cost_for(text,text), public.wn_provider(uuid),
  public.trg_stamp_cost_dispatch_history(), public.trg_stamp_cost_dispatch_recipients(), public.trg_stamp_cost_live_campaign_dispatches(),
  public.trg_stamp_cost_mass_dispatch_targets(), public.trg_stamp_cost_automation_dispatch_sent(), public.trg_stamp_cost_campanha_envios()
FROM PUBLIC, anon, authenticated;
