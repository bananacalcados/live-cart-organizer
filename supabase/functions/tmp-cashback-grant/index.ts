import { createClient } from "npm:@supabase/supabase-js@2";
import { grantSelfserviceCashback } from "../_shared/selfservice-cashback.ts";
const IDS = ["a4eb32c8-c5c1-498d-af26-8023f88ea839","498eadd3-5063-4185-96ae-c733fa58a35f","0c567cc3-c5d7-4d0a-88fd-68c28db6c7e5","bc165497-b6c2-40b4-9ba0-97f0bae99895"];
Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out: any[] = [];
  for (const id of IDS) { try { out.push({ id, r: await grantSelfserviceCashback(sb, id) }); } catch (e) { out.push({ id, error: String(e) }); } }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
