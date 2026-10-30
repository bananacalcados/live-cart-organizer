// Sincroniza públicos personalizados da Meta a partir das regras do ERP.
// Ações: "run" (cron ou admin), "status" (admin: token + contagens na Meta),
// "create_missing" (admin: cria os públicos "ERP –" sem id).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";
import { normalizeMetaPhone } from "../_shared/meta-phone.ts";
import { buildAudienceRow, planDiff, checkGuards, SCHEMA } from "./logic.ts";

const GRAPH = "https://graph.facebook.com/v21.0";
const AD_ACCOUNT = "act_2253897104825255";
const BATCH = 10000;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function getToken(): Promise<string> {
  const { data } = await admin.rpc("meta_ads_get_token");
  const t = (data as string) || Deno.env.get("META_ADS_ACCESS_TOKEN");
  if (!t) throw new Error("Token Meta ausente");
  return t;
}

async function graph(method: string, path: string, token: string, body?: unknown, params: Record<string, string> = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = new URL(GRAPH + path);
    url.searchParams.set("access_token", token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.ok && !data.error) return data;
    const e = data.error || {};
    const transient = res.status >= 500 || e.is_transient || [1, 2, 4, 17, 32, 613, 80003].includes(e.code);
    if (!transient || attempt === 3) throw new Error(e.error_user_msg || e.message || `HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw new Error("unreachable");
}

async function isAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const { data } = await admin.auth.getUser(auth.slice(7));
  if (!data?.user) return false;
  const { data: ok } = await admin.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return !!ok;
}

async function liveToday(): Promise<boolean> {
  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const { data } = await admin.from("events").select("id,start_date,is_live_broadcasting,live_active_until").or(`is_live_broadcasting.eq.true,live_active_until.gt.${new Date().toISOString()},start_date.gte.${today}T00:00:00-03:00`).limit(20);
  return (data || []).some((e: any) => e.is_live_broadcasting || (e.live_active_until && new Date(e.live_active_until) > new Date()) || (e.start_date && String(e.start_date).slice(0, 10) === today));
}

async function syncDefinition(def: any, token: string, opts: { force: boolean }) {
  const { data: run } = await admin.from("meta_audience_sync_runs").insert({ definition_id: def.id, status: "running" }).select("id").single();
  const finish = async (patch: Record<string, unknown>, defPatch: Record<string, unknown>) => {
    await admin.from("meta_audience_sync_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", run!.id);
    await admin.from("meta_audience_definitions").update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...defPatch }).eq("id", def.id);
  };
  try {
    if (def.frozen || !def.audience_id) throw new Error("Público congelado ou sem id");
    const replace = def.initial_mode === "replace" && !def.initial_load_done;
    if (replace && def.initial_load_not_before && new Date(def.initial_load_not_before) > new Date()) {
      await finish({ status: "skipped", details: { reason: "aguardando data da 1ª carga" } }, { last_status: "aguardando_1a_carga" });
      return { skipped: true };
    }
    const { data: refreshed, error: rErr } = await admin.rpc("meta_audience_refresh_candidates", { p_definition_id: def.id });
    if (rErr) throw new Error(rErr.message);

    // candidatos paginados
    const candidates: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("meta_audience_candidates").select("key,phone,email,full_name,city,state,zip").eq("definition_id", def.id).order("key").range(from, from + 999);
      if (error) throw new Error(error.message);
      candidates.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const rows = [];
    for (const c of candidates) rows.push(await buildAudienceRow(c, normalizeMetaPhone));
    const valid = rows.filter((r) => r.hashes.some((h: string) => h));

    const members: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("meta_audience_members").select("key,row_hash,hashes").eq("definition_id", def.id).eq("status", "active").order("key").range(from, from + 999);
      if (error) throw new Error(error.message);
      members.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    let metaLower: number | null = null;
    if (replace) {
      const info = await graph("GET", `/${def.audience_id}`, token, undefined, { fields: "approximate_count_lower_bound" });
      metaLower = Number(info.approximate_count_lower_bound ?? -1);
    }
    const diff = planDiff(valid, members);
    const guard = checkGuards({ replace, erpCount: valid.length, metaLower, activeMembers: members.length, removing: diff.remove.length, force: opts.force });
    if (!guard.ok) {
      await finish({ status: "blocked", mode: replace ? "replace" : "diff", erp_count: valid.length, error: guard.reason }, { last_status: "bloqueado", last_error: guard.reason, erp_count: valid.length });
      return { blocked: guard.reason };
    }

    const now = new Date().toISOString();
    let added = 0, removed = 0;
    if (replace) {
      const sessionId = Number(String(Date.now()).slice(-9));
      const chunks = Math.max(1, Math.ceil(valid.length / BATCH));
      for (let i = 0; i < chunks; i++) {
        const part = valid.slice(i * BATCH, (i + 1) * BATCH);
        await graph("POST", `/${def.audience_id}/usersreplace`, token, {
          payload: { schema: SCHEMA, data: part.map((r) => r.hashes) },
          session: { session_id: sessionId, batch_seq: i + 1, last_batch_flag: i === chunks - 1, estimated_num_total: valid.length },
        });
      }
      added = valid.length;
      await admin.from("meta_audience_members").update({ status: "removed", removed_at: now, updated_at: now }).eq("definition_id", def.id).eq("status", "active");
      for (let i = 0; i < valid.length; i += 1000) {
        await admin.from("meta_audience_members").upsert(valid.slice(i, i + 1000).map((r) => ({ definition_id: def.id, key: r.key, row_hash: r.row_hash, hashes: r.hashes, status: "active", since: now, removed_at: null, updated_at: now })));
      }
    } else {
      for (let i = 0; i < diff.add.length; i += BATCH) {
        const part = diff.add.slice(i, i + BATCH);
        await graph("POST", `/${def.audience_id}/users`, token, { payload: { schema: SCHEMA, data: part.map((r) => r.hashes) } });
        for (let j = 0; j < part.length; j += 1000) {
          await admin.from("meta_audience_members").upsert(part.slice(j, j + 1000).map((r) => ({ definition_id: def.id, key: r.key, row_hash: r.row_hash, hashes: r.hashes, status: "active", since: now, removed_at: null, updated_at: now })));
        }
        added += part.length;
      }
      for (let i = 0; i < diff.remove.length; i += BATCH) {
        const part = diff.remove.slice(i, i + BATCH);
        await graph("DELETE", `/${def.audience_id}/users`, token, { payload: { schema: SCHEMA, data: part.map((m: any) => m.hashes) } });
        const keys = part.map((m: any) => m.key);
        for (let j = 0; j < keys.length; j += 500) {
          await admin.from("meta_audience_members").update({ status: "removed", removed_at: now, updated_at: now }).eq("definition_id", def.id).in("key", keys.slice(j, j + 500));
        }
        removed += part.length;
      }
    }
    await finish(
      { status: "ok", mode: replace ? "replace" : "diff", erp_count: valid.length, added, removed, details: refreshed },
      { last_status: "ok", last_error: null, erp_count: valid.length, added_last: added, removed_last: removed, total_sent: (def.total_sent || 0) + added, total_removed: (def.total_removed || 0) + removed, initial_load_done: true },
    );
    return { added, removed, erp: valid.length };
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500);
    await finish({ status: "error", error: msg }, { last_status: "erro", last_error: msg });
    return { error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  const cron = await isAuthorizedCron(req);
  if (!cron && !(await isAdmin(req))) return json({ error: "Não autorizado" }, 401);
  const action = body.action || "run";
  const token = await getToken();

  if (action === "status") {
    const appToken = `${Deno.env.get("META_APP_ID")}|${Deno.env.get("META_APP_SECRET")}`;
    const dbg = await graph("GET", "/debug_token", appToken, undefined, { input_token: token }).catch(() => null);
    const d = dbg?.data || {};
    const { data: defs } = await admin.from("meta_audience_definitions").select("id,audience_id").not("audience_id", "is", null);
    const now = new Date().toISOString();
    for (const def of defs || []) {
      const info = await graph("GET", `/${def.audience_id}`, token, undefined, { fields: "approximate_count_lower_bound,approximate_count_upper_bound" }).catch(() => null);
      if (info) await admin.from("meta_audience_definitions").update({ meta_approx_lower: info.approximate_count_lower_bound, meta_approx_upper: info.approximate_count_upper_bound, meta_checked_at: now }).eq("id", def.id);
    }
    return json({ token: { type: d.type, valid: d.is_valid, expires_at: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null, ads_management: (d.scopes || []).includes("ads_management") } });
  }

  if (action === "create_missing") {
    const { data: defs } = await admin.from("meta_audience_definitions").select("id,name,description").is("audience_id", null).eq("kind", "erp");
    const created = [];
    for (const def of defs || []) {
      const r = await graph("POST", `/${AD_ACCOUNT}/customaudiences`, token, { name: def.name, description: def.description, subtype: "CUSTOM", customer_file_source: "USER_PROVIDED_ONLY" });
      await admin.from("meta_audience_definitions").update({ audience_id: r.id }).eq("id", def.id);
      created.push({ name: def.name, id: r.id });
    }
    return json({ created });
  }

  // run
  const slot = body.slot || "manual";
  if ((slot === "10h" || slot === "12h") && !(await liveToday())) return json({ skipped: "sem live hoje" });
  let q = admin.from("meta_audience_definitions").select("*").eq("enabled", true).eq("frozen", false).not("audience_id", "is", null);
  if (body.definition_id) q = q.eq("id", body.definition_id);
  if (body.kind) q = q.eq("kind", body.kind);
  const { data: defs } = await q.order("rule_key");
  const results: Record<string, unknown> = {};
  for (const def of defs || []) results[def.name] = await syncDefinition(def, token, { force: false });
  return json({ results });
});
