const SITE = "https://checkout.bananacalcados.com.br";

/** Only inbound text is eligible; never interpret postbacks, echoes or attachment URLs. */
export function rhVagaInboxSource(event: {
  message?: { text?: string; is_echo?: boolean; is_deleted?: boolean; reply_to?: { story?: unknown }; attachments?: Array<{ type?: string }> };
}): "story" | "dm" | null {
  const message = event.message;
  if (!message || message.is_echo || message.is_deleted || !message.text?.trim()) return null;
  return message.reply_to?.story || message.attachments?.some((a) => a.type === "story_mention" || a.type === "ephemeral")
    ? "story" : "dm";
}

export function rhVagaDirectWindowOpen(createdAt: string, now = Date.now()): boolean {
  const age = now - Date.parse(createdAt);
  return Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000;
}

interface RhRule {
  id: string;
  min_delay_seconds?: number | null;
  max_delay_seconds?: number | null;
}

interface RhQueueInput {
  rule: RhRule;
  sourceKey: string;
  username: string;
  message: string;
  commentId: string | null;
  recipientId: string;
  accountId?: string | null;
}

async function sourceUuid(sourceKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`rh_vaga:${sourceKey}`));
  const bytes = new Uint8Array(digest.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function rhVagaUrl(code: string): string {
  if (!/^[a-z0-9]{10,20}$/.test(code)) throw new Error("Link de candidatura inválido");
  return `${SITE}/vaga/${code}`;
}

export function buildRhVagaMetaMessage(job: { message?: string | null; link_token?: string | null }) {
  const text = String(job.message || "").slice(0, 640);
  if (!job.link_token) return { text };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text,
        buttons: [{ type: "web_url", url: rhVagaUrl(job.link_token), title: "Quero me candidatar" }],
      },
    },
  };
}

/** Cria/reutiliza o link e reserva uma única linha por comentário/mensagem + @. Nunca agenda retry. */
export async function enqueueRhVagaNotification(supabase: any, input: RhQueueInput) {
  const username = String(input.username || "").replace(/^@+/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,40}$/.test(username)) return { ok: false, error: "Instagram ausente ou inválido" };

  const { data: vaga, error: vagaError } = await supabase
    .from("rh_vagas")
    .select("id")
    .eq("ativo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (vagaError || !vaga?.id) return { ok: false, error: "Nenhuma vaga ativa" };

  const { data: link, error: linkError } = await supabase.rpc("rh_create_link", {
    p_username: username,
    p_vaga_id: vaga.id,
  });
  if (linkError || !link?.code) return { ok: false, error: "Não foi possível obter o link da vaga" };

  const submitted = link.estado === "enviado";
  const message = submitted
    ? `Oii ${username}! Já recebemos seu cadastro para a vaga da Banana Calçados 💛 Não precisa preencher de novo.`
    : input.message;
  const min = Math.max(20, Number(input.rule.min_delay_seconds) || 20);
  const max = Math.max(min, Math.min(60, Number(input.rule.max_delay_seconds) || 60));
  const delaySeconds = min + Math.floor(Math.random() * (max - min + 1));
  const row = {
    order_id: await sourceUuid(input.sourceKey),
    event_id: null,
    rule_id: input.rule.id,
    kind: "rh_vaga_link",
    instagram_handle: username,
    message,
    status: "pending",
    scheduled_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    link_token: submitted ? null : link.code,
    source_key: input.sourceKey,
    comment_id: input.commentId,
    recipient_id: input.recipientId,
    instagram_account_id: input.accountId || null,
  };
  const { error } = await supabase.from("ig_live_cart_notifications").insert(row);
  if (!error) return { ok: true, submitted, delaySeconds };
  if ((error as any).code === "23505") return { ok: false, duplicate: true, error: "Direct já reservado" };
  return { ok: false, error: String(error.message || error).slice(0, 300) };
}
