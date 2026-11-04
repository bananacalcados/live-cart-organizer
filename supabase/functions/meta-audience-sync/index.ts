// Sincroniza públicos personalizados da Meta a partir das regras do ERP.
// Ações: "run" (cron ou admin), "status" (admin: token + contagens na Meta),
// "create_missing" (admin: cria os públicos "ERP –" sem id).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";
import { normalizeMetaPhone } from "../_shared/meta-phone.ts";
import { buildAudienceRow, planDiff, checkGuards, isRollingWindow, SCHEMA } from "./logic.ts";

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

// Só o dia da live (data em São Paulo). is_live_broadcasting fica preso em true
// depois que a live acaba, então ele não serve para decidir.
async function liveToday(): Promise<boolean> {
  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const { data } = await admin.from("events").select("id").eq("start_date", today).limit(1);
  return (data || []).length > 0;
}

const SELF_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/meta-audience-sync`;
function invokeSelf(body: Record<string, unknown>) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return fetch(SELF_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) })
    .then((r) => r.text()).catch((e) => console.error("[meta-audience-sync] self-invoke falhou", e));
}
function background(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {});
}

const CAND_COLS = "key,phone,email,full_name,city,state,zip";
async function pageAll(build: (from: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function hashRows(cands: any[]) {
  const rows = [];
  for (const c of cands) rows.push(await buildAudienceRow(c, normalizeMetaPhone));
  return rows.filter((r) => r.hashes.some((h: string) => h));
}
async function readMetaCount(def: any, token: string) {
  const info = await graph("GET", `/${def.audience_id}`, token, undefined, { fields: "approximate_count_lower_bound,approximate_count_upper_bound" }).catch(() => null);
  if (!info) return null;
  const patch = { meta_approx_lower: info.approximate_count_lower_bound ?? null, meta_approx_upper: info.approximate_count_upper_bound ?? null, meta_checked_at: new Date().toISOString() };
  await admin.from("meta_audience_definitions").update(patch).eq("id", def.id);
  return patch;
}

type Cursor = { mode: "replace" | "diff"; total: number; removeCount: number; lastKey: string; sent: number; seq: number; sessionId: number; runStart: string; chunks: number };

async function failRun(runId: string, defId: string, msg: string) {
  const now = new Date().toISOString();
  await admin.from("meta_audience_sync_runs").update({ finished_at: now, status: "error", error: msg }).eq("id", runId);
  await admin.from("meta_audience_definitions").update({ last_sync_at: now, updated_at: now, last_status: "erro", last_error: msg }).eq("id", defId);
  console.error(`[meta-audience-sync] ${defId}: ${msg}`);
}

// Fase 1: prepara a rodada (regra, contagens, travas) e devolve o cursor.
async function startDefinition(def: any, token: string): Promise<{ runId?: string; done?: unknown }> {
  // rodada antiga presa (função morta no meio) vira erro visível
  await admin.from("meta_audience_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: "Rodada interrompida (tempo esgotado) — retomada não concluída" })
    .eq("definition_id", def.id).eq("status", "running").lt("started_at", new Date(Date.now() - 30 * 60e3).toISOString());
  const { data: busy } = await admin.from("meta_audience_sync_runs").select("id").eq("definition_id", def.id).eq("status", "running").limit(1);
  if (busy?.length) return { done: { skipped: "rodada em andamento" } };
  const { data: run, error: runErr } = await admin.from("meta_audience_sync_runs").insert({ definition_id: def.id, status: "running" }).select("id,started_at").single();
  if (runErr || !run) throw new Error(runErr?.message || "não criou rodada");
  try {
    if (def.frozen || !def.audience_id) throw new Error("Público congelado ou sem id");
    const replace = def.initial_mode === "replace" && !def.initial_load_done;
    if (replace && def.initial_load_not_before && new Date(def.initial_load_not_before) > new Date()) {
      const now = new Date().toISOString();
      await admin.from("meta_audience_sync_runs").update({ finished_at: now, status: "skipped", details: { reason: "aguardando data da 1ª carga" } }).eq("id", run.id);
      await admin.from("meta_audience_definitions").update({ last_sync_at: now, last_status: "aguardando_1a_carga" }).eq("id", def.id);
      return { done: { skipped: true } };
    }
    const { error: rErr } = await admin.rpc("meta_audience_refresh_candidates", { p_definition_id: def.id });
    if (rErr) throw new Error(rErr.message);
    // só chaves (barato): contagem e quem sai
    const candKeys = await pageAll((f) => admin.from("meta_audience_candidates").select("key").eq("definition_id", def.id).or("phone.not.is.null,email.not.is.null").order("key").range(f, f + 999));
    const memKeys = await pageAll((f) => admin.from("meta_audience_members").select("key").eq("definition_id", def.id).eq("status", "active").order("key").range(f, f + 999));
    const cset = new Set(candKeys.map((c) => c.key));
    const removeCount = memKeys.filter((m) => !cset.has(m.key)).length;
    let metaLower: number | null = null;
    if (replace) {
      const m = await readMetaCount(def, token);
      metaLower = m ? Number(m.meta_approx_lower ?? -1) : null;
    }
    const guard = checkGuards({ replace, erpCount: candKeys.length, metaLower, activeMembers: memKeys.length, removing: removeCount, force: false, rollingWindow: isRollingWindow(def.rule_key) });
    if (!guard.ok) {
      const now = new Date().toISOString();
      await admin.from("meta_audience_sync_runs").update({ finished_at: now, status: "blocked", mode: replace ? "replace" : "diff", erp_count: candKeys.length, error: guard.reason }).eq("id", run.id);
      await admin.from("meta_audience_definitions").update({ last_sync_at: now, updated_at: now, last_status: "bloqueado", last_error: guard.reason, erp_count: candKeys.length }).eq("id", def.id);
      await readMetaCount(def, token);
      return { done: { blocked: guard.reason } };
    }
    const cursor: Cursor = { mode: replace ? "replace" : "diff", total: candKeys.length, removeCount, lastKey: "", sent: 0, seq: 0, sessionId: Number(String(Date.now()).slice(-9)), runStart: run.started_at, chunks: 0 };
    await admin.from("meta_audience_sync_runs").update({ mode: cursor.mode, erp_count: cursor.total, added: 0, removed: 0, details: { cursor } }).eq("id", run.id);
    return { runId: run.id };
  } catch (e) {
    await failRun(run.id, def.id, String((e as Error).message || e).slice(0, 500));
    return { done: { error: String((e as Error).message || e) } };
  }
}

// Fase 2: um lote de até 10.000 por invocação; retoma pelo cursor gravado.
async function stepRun(runId: string, token: string): Promise<"more" | "done"> {
  const { data: run } = await admin.from("meta_audience_sync_runs").select("id,definition_id,status,added,removed,details").eq("id", runId).single();
  if (!run || run.status !== "running") return "done";
  const { data: def } = await admin.from("meta_audience_definitions").select("*").eq("id", run.definition_id).single();
  const c: Cursor = run.details.cursor;
  try {
    const now = new Date().toISOString();
    if (c.lastKey !== null && c.sent < c.total) {
      const cands = await pageAll((f) => f >= BATCH ? Promise.resolve({ data: [], error: null }) :
        admin.from("meta_audience_candidates").select(CAND_COLS).eq("definition_id", def.id).or("phone.not.is.null,email.not.is.null").gt("key", c.lastKey).order("key").range(f, Math.min(f + 999, BATCH - 1)));
      const rows = await hashRows(cands);
      let toSend = rows;
      if (c.mode === "diff" && cands.length) {
        const first = cands[0].key, last = cands[cands.length - 1].key;
        const mem = await pageAll((f) => admin.from("meta_audience_members").select("key,row_hash").eq("definition_id", def.id).eq("status", "active").gte("key", first).lte("key", last).order("key").range(f, f + 999));
        toSend = planDiff(rows, mem).add;
      }
      const isLast = cands.length < BATCH || c.sent + cands.length >= c.total;
      if (c.mode === "replace") {
        c.seq += 1;
        await graph("POST", `/${def.audience_id}/usersreplace`, token, {
          payload: { schema: SCHEMA, data: rows.map((r) => r.hashes) },
          session: { session_id: c.sessionId, batch_seq: c.seq, last_batch_flag: isLast, estimated_num_total: c.total },
        });
      } else if (toSend.length) {
        await graph("POST", `/${def.audience_id}/users`, token, { payload: { schema: SCHEMA, data: toSend.map((r) => r.hashes) } });
      }
      for (let j = 0; j < toSend.length; j += 1000) {
        const { error } = await admin.from("meta_audience_members").upsert(toSend.slice(j, j + 1000).map((r) => ({ definition_id: def.id, key: r.key, row_hash: r.row_hash, hashes: r.hashes, status: "active", since: now, removed_at: null, updated_at: now })));
        if (error) throw new Error(error.message);
      }
      c.sent += cands.length; c.chunks += 1;
      c.lastKey = cands.length ? cands[cands.length - 1].key : c.lastKey;
      if (isLast) c.sent = c.total;
      await admin.from("meta_audience_sync_runs").update({ added: (run.added || 0) + toSend.length, details: { cursor: c } }).eq("id", runId);
      if (c.sent < c.total) return "more";
      run.added = (run.added || 0) + toSend.length;
    }
    // Fase final: saídas
    let removed = 0;
    if (c.mode === "replace") {
      // substituição já tirou da Meta quem não veio; espelha localmente
      const old = await pageAll((f) => admin.from("meta_audience_members").select("key").eq("definition_id", def.id).eq("status", "active").lt("since", c.runStart).order("key").range(f, f + 999));
      for (let j = 0; j < old.length; j += 500) {
        await admin.from("meta_audience_members").update({ status: "removed", removed_at: now, updated_at: now }).eq("definition_id", def.id).in("key", old.slice(j, j + 500).map((m) => m.key));
      }
      removed = old.length;
    } else if (c.removeCount > 0) {
      const candKeys = await pageAll((f) => admin.from("meta_audience_candidates").select("key").eq("definition_id", def.id).or("phone.not.is.null,email.not.is.null").order("key").range(f, f + 999));
      const cset = new Set(candKeys.map((x) => x.key));
      const gone = (await pageAll((f) => admin.from("meta_audience_members").select("key").eq("definition_id", def.id).eq("status", "active").order("key").range(f, f + 999))).filter((m) => !cset.has(m.key)).map((m) => m.key);
      for (let i = 0; i < gone.length; i += BATCH) {
        const keys = gone.slice(i, i + BATCH);
        const hs: any[] = [];
        for (let j = 0; j < keys.length; j += 500) {
          const { data, error } = await admin.from("meta_audience_members").select("hashes").eq("definition_id", def.id).in("key", keys.slice(j, j + 500));
          if (error) throw new Error(error.message);
          hs.push(...(data || []).map((d: any) => d.hashes));
        }
        await graph("DELETE", `/${def.audience_id}/users`, token, { payload: { schema: SCHEMA, data: hs } });
        for (let j = 0; j < keys.length; j += 500) {
          await admin.from("meta_audience_members").update({ status: "removed", removed_at: now, updated_at: now }).eq("definition_id", def.id).in("key", keys.slice(j, j + 500));
        }
        removed += keys.length;
      }
    }
    const added = run.added || 0;
    const fin = new Date().toISOString();
    await admin.from("meta_audience_sync_runs").update({ finished_at: fin, status: "ok", added, removed, details: { cursor: c } }).eq("id", runId);
    await admin.from("meta_audience_definitions").update({
      last_sync_at: fin, updated_at: fin, last_status: "ok", last_error: null, erp_count: c.total, added_last: added, removed_last: removed,
      total_sent: (def.total_sent || 0) + added, total_removed: (def.total_removed || 0) + removed, initial_load_done: true,
    }).eq("id", def.id);
    await readMetaCount(def, token);
    return "done";
  } catch (e) {
    await failRun(runId, def.id, String((e as Error).message || e).slice(0, 500));
    return "done";
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

  // Um público por invocação; cada lote de 10.000 é outra invocação (retoma pelo cursor).
  if (action === "step") {
    background((async () => {
      const r = await stepRun(body.run_id, token);
      if (r === "more") await invokeSelf({ action: "step", run_id: body.run_id });
    })());
    return json({ accepted: true });
  }
  if (action === "sync_one") {
    const { data: def } = await admin.from("meta_audience_definitions").select("*").eq("id", body.definition_id).single();
    if (!def) return json({ error: "público não encontrado" }, 404);
    const work = (async () => {
      try {
        const s = await startDefinition(def, token);
        if (s.runId) await invokeSelf({ action: "step", run_id: s.runId });
        return s.done ?? { started: s.runId };
      } catch (e) {
        const msg = String((e as Error).message || e).slice(0, 500);
        await admin.from("meta_audience_definitions").update({ last_status: "erro", last_error: msg, last_sync_at: new Date().toISOString() }).eq("id", def.id);
        return { error: msg };
      }
    })();
    if (body.wait) return json(await work);
    background(work);
    return json({ accepted: true });
  }

  // run: só despacha
  const slot = body.slot || "manual";
  if ((slot === "10h" || slot === "12h") && !(await liveToday())) return json({ skipped: "sem live hoje" });
  let q = admin.from("meta_audience_definitions").select("id,name").eq("enabled", true).eq("frozen", false).not("audience_id", "is", null);
  if (body.definition_id) q = q.eq("id", body.definition_id);
  if (body.kind) q = q.eq("kind", body.kind);
  const { data: defs } = await q.order("rule_key");
  background(Promise.all((defs || []).map((d: any) => invokeSelf({ action: "sync_one", definition_id: d.id }))));
  return json({ dispatched: (defs || []).map((d: any) => d.name) });
});
