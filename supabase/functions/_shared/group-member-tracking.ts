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

    // ── 3) Captação VIP: ENTRADAS (joins) viram lead OU tagueiam cliente.
    //    Fonte de verdade = evento de entrada do webhook (não o clique no link).
    try {
      const joins = changes
        .filter((c) => c.type === "joined" && !isInternal(c.phone))
        .map((c) => {
          const cust = customerOf(c.phone);
          return {
            phone: c.phone,
            displayName: cust?.name ?? senderName ?? null,
            isCustomer: !!cust?.id,
            customerId: cust?.id ?? null,
          };
        });
      if (joins.length > 0) {
        await captureVipGroupJoins(supabase, groupId, joins);
      }
    } catch (e) {
      console.error("[group-member-tracking] captação VIP:", (e as Error).message);
    }
  } catch (e) {
    console.error("[group-member-tracking] erro geral:", (e as Error).message);
  }
}

/**
 * Extrai o telefone E.164 de um participante retornado por /group/info.
 * Aceita várias chaves possíveis (PhoneNumber, phone, JID, etc.).
 */
function phoneFromParticipant(p: AnyObj): { phone: string; jid: string } | null {
  const candidates = [p?.JID, p?.jid, p?.id, p?.remoteJid, p?.PhoneNumber, p?.phoneNumber, p?.phone, p?.number];
  for (const c of candidates) {
    const raw = asString(c) || "";
    if (!raw) continue;
    const phone = phoneFromJid(raw.includes("@") ? raw : `${raw.replace(/\D/g, "")}@s.whatsapp.net`);
    if (phone) {
      const jid = raw.includes("@") ? raw : `${raw.replace(/\D/g, "")}@s.whatsapp.net`;
      return { phone, jid };
    }
  }
  return null;
}

function participantIsAdmin(p: AnyObj): boolean {
  return Boolean(
    p?.IsAdmin ?? p?.isAdmin ?? p?.admin ?? p?.IsSuperAdmin ?? p?.isSuperAdmin ?? false,
  );
}

/**
 * Tira a "foto inicial" dos membros atuais de um grupo (via /group/info).
 * Faz upsert do estado atual (status='member') e marca como 'left' quem já
 * estava registrado como membro mas não aparece mais na lista atual.
 *
 * Retorna estatísticas para o chamador.
 */
export async function snapshotGroupMembers(
  supabase: any,
  groupIdRaw: string,
  participants: AnyObj[],
  numberId: string | null,
): Promise<{ total: number; resolved: number; internal: number; customers: number; markedLeft: number }> {
  const groupId = digitsOf(groupIdRaw);
  const stats = { total: participants.length, resolved: 0, internal: 0, customers: 0, markedLeft: 0 };
  if (!groupId) return stats;

  // Resolve telefone + admin de cada participante.
  type P = { phone: string; jid: string; isAdmin: boolean };
  const resolved: P[] = [];
  const seen = new Set<string>();
  for (const p of participants) {
    const r = phoneFromParticipant(p);
    if (!r) continue;
    if (seen.has(r.phone)) continue;
    seen.add(r.phone);
    resolved.push({ phone: r.phone, jid: r.jid, isAdmin: participantIsAdmin(p) });
  }
  stats.resolved = resolved.length;
  if (resolved.length === 0) return stats;

  const suffixes = Array.from(new Set(resolved.map((c) => c.phone.slice(-8))));

  // ── Internos (instâncias + vendedores) por sufixo de 8 dígitos.
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
    console.error("[snapshotGroupMembers] internos falhou:", (e as Error).message);
  }

  // ── Enriquecimento CRM por sufixo de 8 dígitos.
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
    console.error("[snapshotGroupMembers] enriquecimento falhou:", (e as Error).message);
  }

  const isInternal = (phone: string) => internalSuffix.has(phone.slice(-8));
  const customerOf = (phone: string) => customerBySuffix.get(phone.slice(-8)) || null;
  const now = new Date().toISOString();

  const rows = resolved.map((c) => {
    const cust = customerOf(c.phone);
    if (isInternal(c.phone)) stats.internal++;
    if (cust) stats.customers++;
    return {
      group_id: groupId,
      instance_id: numberId,
      phone: c.phone,
      jid: c.jid,
      status: "member",
      is_admin: c.isAdmin,
      is_internal: isInternal(c.phone),
      customer_id: cust?.id ?? null,
      display_name: cust?.name ?? null,
      last_event_at: now,
      updated_at: now,
    };
  });

  const { error } = await supabase
    .from("whatsapp_group_members")
    .upsert(rows, { onConflict: "group_id,phone" });
  if (error) console.error("[snapshotGroupMembers] upsert:", error.message);

  // ── Marca como 'left' quem estava registrado como membro mas sumiu da lista.
  try {
    const presentPhones = new Set(resolved.map((c) => c.phone));
    const { data: existing } = await supabase
      .from("whatsapp_group_members")
      .select("phone")
      .eq("group_id", groupId)
      .eq("status", "member");
    const gone = ((existing || []) as AnyObj[])
      .map((e) => asString(e.phone))
      .filter((p): p is string => Boolean(p) && !presentPhones.has(p as string));
    if (gone.length > 0) {
      const { error: leftErr } = await supabase
        .from("whatsapp_group_members")
        .update({ status: "left", left_at: now, updated_at: now })
        .eq("group_id", groupId)
        .in("phone", gone);
      if (!leftErr) stats.markedLeft = gone.length;
    }
  } catch (e) {
    console.error("[snapshotGroupMembers] markLeft falhou:", (e as Error).message);
  }

  return stats;
}

// ════════════════════════════════════════════════════════════════════
// Engajamento de membros: voto em enquete, comentário no grupo e reação.
//
// Grava em whatsapp_group_member_activity (append-only) para turbinar o
// lead scoring. Idempotente por message_id, tolerante a falhas e leve
// (uma busca de internos + uma de CRM por sufixo de 8 dígitos).
// ════════════════════════════════════════════════════════════════════

export type GroupActivityType = "poll_vote" | "group_message" | "reaction";

export interface GroupActivityInput {
  groupId: string;
  instanceId: string | null;
  phone: string;            // telefone E.164 do membro (sender)
  jid?: string | null;
  activityType: GroupActivityType;
  messageId?: string | null;
  content?: string | null;  // emoji da reação / opção da enquete / trecho do texto
  senderName?: string | null;
}

/**
 * Registra UMA atividade de engajamento de um membro de grupo.
 * Nunca lança — qualquer erro é logado e engolido para não derrubar o webhook.
 */
export async function recordGroupActivity(
  supabase: any,
  input: GroupActivityInput,
): Promise<void> {
  try {
    const groupId = digitsOf(input.groupId);
    const phone = digitsOf(input.phone);
    if (!groupId || !phone) return;

    const suffix = phone.slice(-8);

    // ── Interno? (instâncias + vendedores) por sufixo de 8 dígitos.
    let isInternal = false;
    try {
      const [{ data: nums }, { data: sellers }] = await Promise.all([
        supabase.from("whatsapp_numbers").select("uazapi_owner, phone_display, wasender_phone_number"),
        supabase.from("pos_sellers").select("whatsapp_phone"),
      ]);
      const internalSuffix = new Set<string>();
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
      isInternal = internalSuffix.has(suffix);
    } catch (e) {
      console.error("[recordGroupActivity] internos falhou:", (e as Error).message);
    }

    // ── Vínculo CRM por sufixo de 8 dígitos.
    let customerId: string | null = null;
    let crmName: string | null = null;
    try {
      const { data: customers } = await supabase
        .from("crm_customers_v")
        .select("id, name, phone_suffix8")
        .eq("phone_suffix8", suffix)
        .limit(1);
      const c = ((customers || []) as AnyObj[])[0];
      if (c) {
        customerId = (c.id as string) ?? null;
        crmName = asString(c.name);
      }
    } catch (e) {
      console.error("[recordGroupActivity] enriquecimento falhou:", (e as Error).message);
    }

    const row: AnyObj = {
      group_id: groupId,
      instance_id: input.instanceId,
      phone,
      jid: input.jid ?? null,
      activity_type: input.activityType,
      message_id: input.messageId ?? null,
      content: input.content ? String(input.content).slice(0, 300) : null,
      is_internal: isInternal,
      customer_id: customerId,
      display_name: crmName ?? input.senderName ?? null,
    };

    // Dedup por message_id (índice único parcial). Sem message_id, sempre insere.
    if (row.message_id) {
      const { error } = await supabase
        .from("whatsapp_group_member_activity")
        .upsert(row, { onConflict: "message_id", ignoreDuplicates: true });
      if (error) console.error("[recordGroupActivity] upsert:", error.message);
    } else {
      const { error } = await supabase.from("whatsapp_group_member_activity").insert(row);
      if (error) console.error("[recordGroupActivity] insert:", error.message);
    }

    // Mantém last_event_at do membro fresco (se já existir registro de membro).
    try {
      await supabase
        .from("whatsapp_group_members")
        .update({ last_event_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .eq("phone", phone);
    } catch {
      // best-effort
    }
  } catch (e) {
    console.error("[recordGroupActivity] erro geral:", (e as Error).message);
  }
}
