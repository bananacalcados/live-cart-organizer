import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Cadastra / atualiza uma conta de Instagram (multi-conta) em whatsapp_numbers.
 *
 * Recebe apenas { label, accessToken } e descobre automaticamente o
 * instagram_account_id e o @username chamando a Graph API do Instagram.
 * Grava tudo como uma linha provider='instagram' — reaproveitando toda a
 * infra de instâncias (filtro por conversa, roteamento de token, etc).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Exige usuário autenticado
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const label = String(body.label || "").trim();
    const accessToken = String(body.accessToken || "").trim();
    const isDefault = Boolean(body.isDefault);
    const rowId: string | null = body.id ? String(body.id) : null;

    if (!accessToken && !rowId) {
      return new Response(JSON.stringify({ error: "accessToken é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accountId: string | null = null;
    let username: string | null = null;

    // Descobre account_id + username via Graph API (só quando um token novo é enviado)
    if (accessToken) {
      const url = `https://graph.instagram.com/v23.0/me?fields=user_id,username,id&access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[ig-account-connect] Graph error:", JSON.stringify(data));
        return new Response(
          JSON.stringify({ error: "Token inválido ou sem permissão", details: data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      accountId = String(data.user_id || data.id || "");
      username = data.username ? String(data.username) : null;
      if (!accountId) {
        return new Response(
          JSON.stringify({ error: "Não foi possível identificar a conta do Instagram", details: data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const payload: Record<string, unknown> = {
      provider: "instagram",
      is_active: true,
    };
    if (label) payload.label = label;
    if (typeof body.isDefault === "boolean") payload.is_default = isDefault;
    if (accessToken) {
      payload.access_token = accessToken;
      payload.instagram_account_id = accountId;
      payload.instagram_username = username;
      payload.phone_display = username ? `@${username}` : (label || "Instagram");
    }

    let saved;
    if (rowId) {
      const { data, error } = await supabase
        .from("whatsapp_numbers")
        .update(payload)
        .eq("id", rowId)
        .select("id, label, instagram_username, instagram_account_id")
        .single();
      if (error) throw error;
      saved = data;
    } else {
      // Evita duplicar a mesma conta (mesmo instagram_account_id)
      if (accountId) {
        const { data: existing } = await supabase
          .from("whatsapp_numbers")
          .select("id")
          .eq("provider", "instagram")
          .eq("instagram_account_id", accountId)
          .maybeSingle();
        if (existing?.id) {
          const { data, error } = await supabase
            .from("whatsapp_numbers")
            .update(payload)
            .eq("id", existing.id)
            .select("id, label, instagram_username, instagram_account_id")
            .single();
          if (error) throw error;
          saved = data;
        }
      }
      if (!saved) {
        if (!payload.label) payload.label = username ? `@${username}` : "Instagram";
        const { data, error } = await supabase
          .from("whatsapp_numbers")
          .insert(payload)
          .select("id, label, instagram_username, instagram_account_id")
          .single();
        if (error) throw error;
        saved = data;
      }
    }

    return new Response(JSON.stringify({ success: true, account: saved }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[ig-account-connect] error:", e?.message || e);
    return new Response(JSON.stringify({ error: e?.message || "internal_error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
