// Mercado Pago Point — painel de diagnóstico das maquininhas (Point Smart).
//
// Ações:
//   - "list":     GET /terminals/v1/list  → lista os terminais da conta e o
//                 operating_mode de cada um (PDV = integrado / STANDALONE = avulso).
//   - "set_mode": PATCH /terminals/v1/setup → alterna o modo de um terminal
//                 entre "PDV" e "STANDALONE".
//
// Usa o token da APLICAÇÃO Point (secret MP_POINT_ACCESS_TOKEN). Credenciais de
// TESTE só enxergam terminais simulados; as maquininhas físicas reais aparecem
// somente com o token de PRODUÇÃO da conta.
//
// Acesso restrito a usuários autenticados com papel "admin".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MP_API = "https://api.mercadopago.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // --- Auth: exige usuário autenticado com papel admin ---
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Faça login novamente." }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Sessão inválida. Faça login novamente." }, 401);
    }

    const sb = createClient(url, serviceKey);
    const { data: isAdmin } = await sb.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return json({ error: "Apenas administradores podem acessar as maquininhas." }, 403);
    }

    const accessToken = Deno.env.get("MP_POINT_ACCESS_TOKEN");
    if (!accessToken) {
      return json(
        {
          error:
            "Credenciais da aplicação Point não configuradas (MP_POINT_ACCESS_TOKEN).",
        },
        400,
      );
    }
    const isSandbox = accessToken.startsWith("TEST-");

    let body: { action?: string; terminal_id?: string; operating_mode?: string } = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }
    const action = body.action || "list";

    const mpHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    if (action === "list") {
      const resp = await fetch(`${MP_API}/terminals/v1/list`, { headers: mpHeaders });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error("[point-terminals] list error", resp.status, JSON.stringify(data));
        return json(
          {
            error: data?.message || `Erro Mercado Pago (${resp.status})`,
            mp_status: resp.status,
            is_sandbox: isSandbox,
          },
          200,
        );
      }
      const terminals = data?.data?.terminals ?? data?.terminals ?? [];
      return json({ ok: true, is_sandbox: isSandbox, terminals });
    }

    if (action === "set_mode") {
      const terminalId = body.terminal_id;
      const mode = (body.operating_mode || "").toUpperCase();
      if (!terminalId) return json({ error: "terminal_id obrigatório" }, 400);
      if (mode !== "PDV" && mode !== "STANDALONE") {
        return json({ error: "operating_mode deve ser PDV ou STANDALONE" }, 400);
      }
      const resp = await fetch(`${MP_API}/terminals/v1/setup`, {
        method: "PATCH",
        headers: mpHeaders,
        body: JSON.stringify({
          terminals: [{ id: terminalId, operating_mode: mode }],
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error("[point-terminals] set_mode error", resp.status, JSON.stringify(data));
        return json(
          { error: data?.message || `Erro Mercado Pago (${resp.status})`, mp_status: resp.status },
          200,
        );
      }
      return json({ ok: true, is_sandbox: isSandbox, result: data });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err: any) {
    console.error("[point-terminals] fatal", err?.message);
    return json({ error: err?.message || "Erro interno" }, 500);
  }
});
