// Código de acesso PERMANENTE do cliente (OTP eterno).
// Regra de negócio: uma vez gerado para um telefone, o código é dele para sempre
// — só muda se um operador alterar manualmente (set_customer_access_code).
// O envio usa um template da Meta API configurado em `otp_template_settings`.

type Sb = any;

/** Normaliza para E.164 BR injetando o 9º dígito quando necessário. */
export function normalizeBrPhone(input: string): string | null {
  let d = String(input || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2);
  if (d.length !== 11) return null;
  return "55" + d;
}

/** Retorna (criando na primeira vez) o código permanente do telefone. */
export async function getOrCreateAccessCode(supabase: Sb, phone: string): Promise<string | null> {
  const e164 = normalizeBrPhone(phone);
  if (!e164) return null;
  const { data, error } = await supabase.rpc("get_or_create_customer_access_code", { _phone: e164 });
  if (error) {
    console.error("[access-code] rpc error", error.message);
    return null;
  }
  return (data as string) || null;
}

/**
 * Confere o código informado contra o código permanente do telefone.
 * Nunca expira. Mantém compatibilidade com os códigos temporários antigos
 * (live_phone_verifications) para não quebrar sessões em andamento.
 */
export async function verifyAccessCode(supabase: Sb, phone: string, code: string): Promise<boolean> {
  const e164 = normalizeBrPhone(phone);
  const clean = String(code || "").replace(/\D/g, "");
  if (!e164 || clean.length < 4) return false;

  const { data: perm } = await supabase
    .from("customer_access_codes")
    .select("code")
    .eq("phone", e164)
    .maybeSingle();
  if (perm?.code && perm.code === clean) return true;

  const { data: legacy } = await supabase
    .from("live_phone_verifications")
    .select("id, code, expires_at")
    .eq("phone", e164)
    .eq("verified", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (legacy?.code === clean && new Date(legacy.expires_at) > new Date()) {
    await supabase.from("live_phone_verifications").update({ verified: true }).eq("id", legacy.id);
    return true;
  }
  return false;
}

/**
 * Envia o código permanente pelo WhatsApp usando o template configurado.
 * Retorna { ok, error }.
 */
export async function sendAccessCode(
  supabase: Sb,
  phone: string,
): Promise<{ ok: boolean; error?: string }> {
  const e164 = normalizeBrPhone(phone);
  if (!e164) return { ok: false, error: "Telefone inválido" };

  const code = await getOrCreateAccessCode(supabase, e164);
  if (!code) return { ok: false, error: "Não foi possível gerar o código" };

  const { data: cfg } = await supabase
    .from("otp_template_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  if (cfg?.template_name) {
    const idx = Math.max(1, Number(cfg.code_variable_index) || 1);
    const params = Array.from({ length: idx }, (_, i) => ({
      type: "text",
      text: i === idx - 1 ? code : " ",
    }));
    const components: any[] = [{ type: "body", parameters: params }];
    if (cfg.copy_code_button) {
      components.push({
        type: "button",
        sub_type: "url",
        index: 0,
        parameters: [{ type: "text", text: code }],
      });
    }

    const res = await fetch(`${url}/functions/v1/meta-whatsapp-send-template`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        phone: e164,
        templateName: cfg.template_name,
        language: cfg.template_language || "pt_BR",
        whatsappNumberId: cfg.whatsapp_number_id || undefined,
        components,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.success !== false) return { ok: true };
    console.error("[access-code] template send failed", data);
    if (!cfg.fallback_to_text) {
      return { ok: false, error: data?.error || "Falha ao enviar o código pelo template" };
    }
  }

  // Fallback: mensagem de sessão (só funciona dentro da janela de 24h).
  const message =
    `🔐 Seu código de acesso Banana Calçados é *${code}*.\n\n` +
    `Ele é fixo: use sempre este mesmo código para acessar sua área de cliente e girar a roleta.`;
  const res = await fetch(`${url}/functions/v1/meta-whatsapp-send`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      phone: e164,
      message,
      type: "text",
      whatsappNumberId: cfg?.whatsapp_number_id || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.success !== false) return { ok: true };
  return {
    ok: false,
    error:
      data?.error ||
      "Não foi possível enviar o código. Configure o template de OTP na área de clientes.",
  };
}
