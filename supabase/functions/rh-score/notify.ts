import { resolveUazapiCredentials, uazapiInstance, formatUazapiNumber } from "../_shared/uazapi-credentials.ts";

const SITE = "https://checkout.bananacalcados.com.br";

export function buildCandidateNotice(input: {
  candidato_id: string;
  nome?: string | null;
  idade?: number | null;
  bairro?: string | null;
  nota: number;
  parcial?: boolean | null;
}): string {
  const score = Number(input.nota);
  const formatted = Number.isInteger(score) ? String(score) : score.toFixed(1).replace(".", ",");
  return `Novo candidato: ${input.nome || "Não informado"}, ${input.idade ?? "—"} anos, ${input.bairro || "Não informado"}. Nota ${formatted}/100${input.parcial ? " (parcial)" : ""}. Ver respostas, notas e impressões da IA: ${SITE}/rh/candidato/${input.candidato_id}`;
}

function providerMessageId(data: any): string | null {
  return data?.messageid || data?.id || data?.message?.messageid || data?.message?.id || null;
}

function errorMessage(data: any): string {
  const value = data?.error || data?.message || "Falha no envio pelo uazapi";
  return String(typeof value === "string" ? value : JSON.stringify(value)).slice(0, 800);
}

export async function sendRhCandidateNotice(supabase: any, candidatoId: string, manual = false) {
  const { data: claim, error: claimError } = await supabase.rpc("rh_aviso_claim", {
    p_id: candidatoId,
    p_manual: manual,
  });
  if (claimError) return { ok: false, message: "Não foi possível reservar o aviso." };
  if (!claim?.ok) return claim;

  let ok = false;
  let error: string | null = null;
  let messageId: string | null = null;
  try {
    const { token } = await resolveUazapiCredentials(claim.aviso_instancia_id);
    const result = await uazapiInstance("/send/text", token, {
      method: "POST",
      body: {
        number: formatUazapiNumber(claim.aviso_numero),
        text: buildCandidateNotice(claim),
      },
    });
    ok = result.ok;
    messageId = providerMessageId(result.data);
    if (!ok) error = errorMessage(result.data);
  } catch (e) {
    error = `Resultado incerto; reenvio somente manual: ${e instanceof Error ? e.message : String(e)}`.slice(0, 800);
  }

  const { data: finished, error: finishError } = await supabase.rpc("rh_aviso_finish", {
    p_id: candidatoId,
    p_token: claim.token,
    p_ok: ok,
    p_error: error,
    p_provider_message_id: messageId,
  });
  if (finishError || !finished) return { ok: false, message: "O envio terminou, mas o status não pôde ser salvo." };
  return ok ? { ok: true, message: "Aviso enviado." } : { ok: false, message: error || "Falha no aviso." };
}

export async function sendRhTestNotice(supabase: any) {
  const { data: settings, error } = await supabase
    .from("rh_settings")
    .select("aviso_numero,aviso_instancia_id")
    .eq("id", 1)
    .maybeSingle();
  if (error) return { ok: false, message: "Não foi possível ler as configurações." };
  if (!settings?.aviso_instancia_id) return { ok: false, message: "Escolha e salve a instância uazapi antes do teste." };
  if (!/^55[1-9]{2}9?[0-9]{8}$/.test(settings.aviso_numero || "")) return { ok: false, message: "Número do aviso inválido." };

  const text = `Teste de aviso do RH ✅\nNovo candidato: Maria Exemplo, 25 anos, Centro. Nota 90/100. Ver respostas, notas e impressões da IA: ${SITE}/pos\n(candidato fictício; nenhum cadastro foi criado)`;
  let ok = false;
  let sendError: string | null = null;
  try {
    const { token } = await resolveUazapiCredentials(settings.aviso_instancia_id);
    const result = await uazapiInstance("/send/text", token, {
      method: "POST",
      body: { number: formatUazapiNumber(settings.aviso_numero), text },
    });
    ok = result.ok;
    if (!ok) sendError = errorMessage(result.data);
  } catch (e) {
    sendError = `Resultado incerto: ${e instanceof Error ? e.message : String(e)}`.slice(0, 800);
  }

  await supabase.from("rh_settings").update({
    aviso_ultimo_status: ok ? "enviado" : "falhou",
    aviso_ultimo_erro: ok ? null : sendError,
    aviso_ultimo_at: new Date().toISOString(),
    aviso_ultimo_tipo: "teste",
  }).eq("id", 1);
  return ok ? { ok: true, message: "Aviso de teste enviado." } : { ok: false, message: sendError || "Falha no teste." };
}
