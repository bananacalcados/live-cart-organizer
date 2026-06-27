// ════════════════════════════════════════════════════════════════════
// Rastreamento de movimentação de membros de grupos WhatsApp (uazapi).
//
// Consome o evento `groups` da uazapi (whatsmeow GroupInfo) e grava:
//   - whatsapp_group_members        → estado ATUAL de cada participante
//   - whatsapp_group_member_events  → histórico append-only (entrou/saiu/etc.)
//
// Regras importantes:
//   - O MESMO evento chega repetido (uma vez por instância da empresa no grupo
//     e em reenvios). Deduplicamos pelo `ParticipantVersionID` (idempotente).
//   - Números da empresa (instâncias) e de vendedores são marcados `is_internal`
//     para serem ignorados no lead scoring.
//   - Tudo roda em try/catch: NUNCA pode derrubar o processamento do webhook.
// ════════════════════════════════════════════════════════════════════

type AnyObj = Record<string, unknown>;

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v == null) return null;
  return String(v);
}

/** Extrai apenas os dígitos de um JID/telefone. */
function digitsOf(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/**
 * Normaliza um JID individual `5527...@s.whatsapp.net` para telefone E.164 BR.
 * Retorna null para JIDs @lid (privacidade) ou inválidos — não conseguimos
 * resolver o telefone real nesses casos.
 */
function phoneFromJid(jid: string): string | null {
  const raw = String(jid || "");
  if (raw.includes("@lid")) return null; // LID: telefone oculto
  let digits = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (!digits) return null;
  // Injeção do 9º dígito (padrão E.164 do projeto)
  if (digits.length >= 10 && digits.length <= 11) digits = "55" + digits;
  if (digits.startsWith("55") && digits.length === 12) {
    const ddd = digits.substring(2, 4);
    const number = digits.substring(4);
    digits = "55" + ddd + "9" + number;
  }
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? (v.map((x) => asString(x)).filter(Boolean) as string[]) : [];

/**
 * Processa um evento `groups` e atualiza o rastreamento de membros.
 * Idempotente e tolerante a falhas.
 */
export async function processGroupMembershipEvent(
  supabase: any,
  payload: AnyObj,
  numberId: string | null,
): Promise<void> {
  try {
    const ev = (payload.event as AnyObj) || {};
    const groupId = digitsOf(ev.JID);
    if (!groupId) return;

    const version = asString(ev.ParticipantVersionID);
    const senderName = asString(ev.Notify);
    const actorPhone = phoneFromJid(asString(ev.SenderPN) || asString(ev.Sender) || "");

    let eventAt = new Date().toISOString();
    const tsRaw = asString(ev.Timestamp);
    if (tsRaw) {
      const parsed = new Date(tsRaw);
      if (!isNaN(parsed.getTime())) eventAt = parsed.toISOString();
    }

    // Coleta as mudanças de participantes. (Leave cobre saída voluntária E remoção.)
    type Change = {
      type: "joined" | "left" | "promoted" | "demoted";
      phone: string;
      jid: string;
      status?: "member" | "left";
      isAdmin?: boolean;
    };
    const changes: Change[] = [];
    const collect = (
      jids: string[],
      type: Change["type"],
      status?: Change["status"],
      isAdmin?: boolean,
    ) => {
      for (const jid of jids) {
        const phone = phoneFromJid(jid);
        if (!phone) continue;
        changes.push({ type, phone, jid, status, isAdmin });
      }
    };
    collect(arr(ev.Join), "joined", "member");
    collect(arr(ev.Leave), "left", "left");
    collect(arr(ev.Promote), "promoted", undefined, true);
    collect(arr(ev.Demote), "demoted", undefined, false);

    if (changes.length === 0) return; // evento sem mudança de participante (ex.: troca de nome)

    // ── Resolve telefones internos (instâncias + vendedores) por sufixo de 8 dígitos.
    const suffixes = Array.from(new Set(changes.map((c) => c.phone.slice(-8))));
    const internalSuffix = new Set<string>();
    try {
      const [{ data: nums }, { data: sellers }] = await Promise.all([
        supabase.from("whatsapp_numbers").select("uazapi_owner, phone_display, wasender_phone_number"),
        supabase.from("pos_sellers").select("whatsapp_phone"),
      ]);
      for (const n of (nums || []) as AnyObj[]) {
        for (const key of ["uazapi_owner", "phone_display", "wasender_phone_number"]) {
          const d = digitsOf((n as AnyObj)[key]);
          if (d.length >= 8) internalSuffix.add(d.slice(-8));
        }
      }
      for (const s of (sellers || []) as AnyObj[]) {
        const d = digitsOf((s as AnyObj).whatsapp_phone);
        if (d.length >= 8) internalSuffix.add(d.slice(-8));
      }
    } catch (e) {
      console.error("[group-member-tracking] internos falhou:", (e as Error).message);
    }

    // ── Enriquecimento com cliente do CRM (crm_customers_v) por sufixo de 8 dígitos.
    const customerBySuffix = new Map<string, { id: string; name: string | null }>();
    try {
      const { data: customers } = await supabase
        .from("crm_customers_v")
        .select("id, name, phone_suffix8")
        .in("phone_suffix8", suffixes);
      for (const c of (customers || []) as AnyObj[]) {
        const sfx = asString((c as AnyObj).phone_suffix8);
        if (sfx && !customerBySuffix.has(sfx)) {
          customerBySuffix.set(sfx, { id: (c as AnyObj).id as string, name: asString((c as AnyObj).name) });
        }
      }
    } catch (e) {
      console.error("[group-member-tracking] enriquecimento falhou:", (e as Error).message);
    }

    const isInternal = (phone: string) => internalSuffix.has(phone.slice(-8));
    const customerOf = (phone: string) => customerBySuffix.get(phone.slice(-8)) || null;

    // ── 1) Histórico (append-only, idempotente por ParticipantVersionID).
    const eventRows = changes.map((c) => {
      const cust = customerOf(c.phone);
      return {
        group_id: groupId,
        instance_id: numberId,
        phone: c.phone,
        jid: c.jid,
        event_type: c.type,
        is_internal: isInternal(c.phone),
        actor_phone: actorPhone,
        customer_id: cust?.id ?? null,
        display_name: cust?.name ?? senderName ?? null,
        source_version_id: version,
        created_at: eventAt,
      };
    });
    if (eventRows.length > 0) {
      // ON CONFLICT DO NOTHING via índice único de dedup (group_id, phone, event_type, version)
      const { error } = await supabase
        .from("whatsapp_group_member_events")
        .upsert(eventRows, {
          onConflict: "group_id,phone,event_type,source_version_id",
          ignoreDuplicates: true,
        });
      if (error) console.error("[group-member-tracking] insert events:", error.message);
    }

    // ── 2) Estado atual (upsert por group_id+phone).
    for (const c of changes) {
      const cust = customerOf(c.phone);
      const base: AnyObj = {
        group_id: groupId,
        instance_id: numberId,
        phone: c.phone,
        jid: c.jid,
        is_internal: isInternal(c.phone),
        customer_id: cust?.id ?? null,
        display_name: cust?.name ?? senderName ?? null,
        last_event_at: eventAt,
        updated_at: new Date().toISOString(),
      };
      if (c.type === "joined") {
        base.status = "member";
        base.joined_at = eventAt;
      } else if (c.type === "left") {
        base.status = "left";
        base.left_at = eventAt;
      } else if (c.type === "promoted") {
        base.is_admin = true;
      } else if (c.type === "demoted") {
        base.is_admin = false;
      }
      const { error } = await supabase
        .from("whatsapp_group_members")
        .upsert(base, { onConflict: "group_id,phone" });
      if (error) console.error("[group-member-tracking] upsert member:", error.message);
    }
  } catch (e) {
    console.error("[group-member-tracking] erro geral:", (e as Error).message);
  }
}
