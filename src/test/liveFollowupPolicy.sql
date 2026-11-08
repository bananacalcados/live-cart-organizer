-- Authenticated admin only. Synthetic rows rollback inside the RPC; no provider calls.
SELECT public.live_followup_policy_simulate();
-- All policy fields must be true, provider_calls=0, rolled_back=true.
-- Concrete assertions: sender initial/fallback/missing; comment != DM window;
-- live ended blocks; posts allowed before 7 days, blocked after; DM 24h boundary;
-- LID reply/opt-out/manual stop, isolation by instance; atomic private claim once.