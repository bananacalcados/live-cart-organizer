import { withAccessLog } from "../_shared/withAccessLog.ts";
import { requireAuth } from "../_shared/requireAuth.ts";
// Instalação do app AppMax (OAuth2) na loja do CNPJ.
// ?action=validate  → URL de validação (AppMax chama server-to-server)
// ?action=start&env=production|sandbox → gera link de autorização (requer usuário logado)
// ?action=callback&env=... → AppMax redireciona aqui com ?token=<hash>; trocamos por credenciais da loja
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/require-user.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Env = "production" | "sandbox";
const HOSTS: Record<Env, { auth: string; api: string; admin: string }> = {
  production: { auth: "https://auth.appmax.com.br", api: "https://api.appmax.com.br", admin: "https://admin.appmax.com.br" },
  sandbox: { auth: "https://auth.sandboxappmax.com.br", api: "https://api.sandboxappmax.com.br", admin: "https://breakingcode.sandboxappmax.com.br" },
};
const sfx = (env: Env) => (env === "sandbox" ? "_SANDBOX" : "");
const appCreds = (env: Env) => ({
  id: Deno.env.get(`APPMAX_APP_CLIENT_ID${sfx(env)}`) || "",
  secret: Deno.env.get(`APPMAX_APP_CLIENT_SECRET${sfx(env)}`) || "",
  uuid: Deno.env.get(`APPMAX_APP_UUID${sfx(env)}`) || "",
});

async function oauthToken(env: Env, id: string, secret: string): Promise<string> {
  const r = await fetch(`${HOSTS[env].auth}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`oauth2/token [${r.status}]: ${t}`);
  return JSON.parse(t).access_token;
}

const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const fnUrl = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/appmax-install`;
const page = (title: string, msg: string, s = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:sans-serif;max-width:560px;margin:60px auto"><h2>${title}</h2><p>${msg}</p></body>`,
    { status: s, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

Deno.serve(withAccessLog("appmax-install", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "validate";
  const env: Env = url.searchParams.get("env") === "sandbox" ? "sandbox" : "production";
  const sb = db();

  try {
    if (action === "validate") {
      const body = await req.json().catch(() => ({}));
      if (body?.app_id === undefined || body?.app_id === null) return json({ error: "app_id obrigatório" }, 400);
      // Descobre o ambiente pela external_key (formato bc-<env>) ou query
      const key = String(body.external_key || body.client_key || "");
      const e: Env = key.includes("sandbox") ? "sandbox" : key.includes("production") ? "production" : env;
      // Fase 4: só aceita durante uma instalação iniciada por admin (status authorizing, últimos 30 min);
      // fora disso não grava nada, para ninguém sobrescrever as credenciais do gateway.
      {
        const { data: cur } = await sb.from("appmax_installations").select("status, updated_at, external_id").eq("env", e).maybeSingle();
        const fresh = cur?.status === "authorizing" && Date.now() - new Date(String(cur.updated_at)).getTime() < 30 * 60_000;
        if (!fresh) {
          try { await sb.from("security_events").insert({ event: "appmax_validate_blocked", ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null, details: { env: e, status: cur?.status ?? null } }); } catch (_) { /* ignore */ }
          return json({ external_id: cur?.external_id ?? null, alias: "Banana Calçados" });
        }
      }
      const externalId = crypto.randomUUID(); // a cada instalação um valor novo
      const patch: Record<string, unknown> = {
        env: e, external_id: externalId, app_numeric_id: Number(body.app_id) || null,
        external_key: key || null, updated_at: new Date().toISOString(),
      };
      if (body.client_id && body.client_secret) {
        patch.merchant_client_id = body.client_id;
        patch.merchant_client_secret = body.client_secret;
      }
      await sb.from("appmax_installations").upsert(patch, { onConflict: "env" });
      return json({ external_id: externalId, alias: "Banana Calçados" });
    }

    if (action === "start") {
      const auth = await requireUser(req);
      if (!auth.ok) return auth.response;
      { const denied = await requireAuth(req, [], true); if (denied) return denied; }
      const c = appCreds(env);
      if (!c.id || !c.secret || !c.uuid) return json({ error: `Credenciais do app (${env}) não configuradas` }, 400);
      const token = await oauthToken(env, c.id, c.secret);
      const r = await fetch(`${HOSTS[env].api}/app/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          app_id: c.uuid,
          external_key: `bc-${env}`,
          url_callback: `${fnUrl()}?action=callback&env=${env}`,
          domain_name: "checkout.bananacalcados.com.br",
        }),
      });
      const t = await r.text();
      if (!r.ok) return json({ error: "authorize falhou", status: r.status, details: t }, r.status);
      const hash = JSON.parse(t)?.data?.token;
      await sb.from("appmax_installations").upsert({ env, status: "authorizing", updated_at: new Date().toISOString() }, { onConflict: "env" });
      return json({ authorize_url: `${HOSTS[env].admin}/appstore/integration/${hash}` });
    }

    if (action === "callback") {
      const hash = url.searchParams.get("token");
      if (!hash) return page("Faltou o código", "A AppMax não enviou o código de autorização.", 400);
      {
        const { data: cur } = await sb.from("appmax_installations").select("status, updated_at").eq("env", env).maybeSingle();
        const fresh = cur?.status === "authorizing" && Date.now() - new Date(String(cur.updated_at)).getTime() < 60 * 60_000;
        if (!fresh) return page("Instalação não iniciada", "Inicie a conexão pelo painel do ERP (Admin) e tente de novo.", 403);
      }
      const c = appCreds(env);
      const token = await oauthToken(env, c.id, c.secret);
      const r = await fetch(`${HOSTS[env].api}/app/client/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ token: hash }),
      });
      const t = await r.text();
      if (!r.ok) {
        await sb.from("appmax_installations").upsert({ env, status: "error", last_error: `[${r.status}] ${t}`.slice(0, 1000), updated_at: new Date().toISOString() }, { onConflict: "env" });
        return page("Não foi possível concluir", `A AppMax recusou a instalação (${r.status}). Avise o suporte técnico.`, 502);
      }
      const cl = JSON.parse(t)?.data?.client || {};
      // Confirma que as credenciais da loja funcionam
      await oauthToken(env, cl.client_id, cl.client_secret);
      await sb.from("appmax_installations").upsert({
        env, merchant_client_id: cl.client_id, merchant_client_secret: cl.client_secret,
        status: "installed", last_error: null, installed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "env" });
      return page("AppMax conectada ✅", `Instalação concluída (${env === "sandbox" ? "teste" : "produção"}). Pode fechar esta janela.`);
    }

    return json({ error: "ação inválida" }, 400);
  } catch (e) {
    console.error("[appmax-install]", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
}));
