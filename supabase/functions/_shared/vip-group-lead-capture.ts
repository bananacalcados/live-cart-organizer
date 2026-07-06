// ════════════════════════════════════════════════════════════════════
// Captura de LEAD / TAG quando alguém ENTRA num grupo VIP.
//
// FONTE DE VERDADE = evento de ENTRADA vindo do webhook (não o clique).
//
// Regras (espelham o dashboard e a trava "cliente não vira lead"):
//   - Se o telefone JÁ É CLIENTE (existe em customers_unified / crm_customers_v):
//       NÃO cria lead. Apenas acrescenta as tags de grupo + campanha.
//   - Se NÃO é cliente:
//       cria/atualiza LEAD no MESMO balde que alimenta o canal "Grupo VIP"
//       do dashboard: lp_leads (source='external_lead', campaign_tag='grupo-vip').
//
// IDEMPOTÊNCIA (telefone normalizado + tag):
//   - telefone já existente (cliente OU lead) => nunca cria novo cadastro,
//     só adiciona a(s) tag(s) que ainda não tiver.
//   - mesma pessoa em vários grupos => acumula tags, 1 cadastro só.
//   - entrar/sair/reentrar no mesmo grupo => sem duplicata e sem tag repetida.
//
// Tudo em try/catch: NUNCA pode derrubar o processamento do webhook.
// ════════════════════════════════════════════════════════════════════

type AnyObj = Record<string, unknown>;

export type VipJoin = {
  phone: string;               // E.164 normalizado (ex.: 5533991398763)
  displayName: string | null;  // nome se a API/CRM fornecer
  isCustomer: boolean;         // já é cliente? (customer_id resolvido do CRM)
  customerId: string | null;   // customers_unified.id quando cliente
};

const digitsOf = (v: unknown): string => String(v ?? "").replace(/\D/g, "");
const last8 = (v: unknown): string => digitsOf(v).slice(-8);

function uniqMerge(existing: unknown, incoming: string[]): { merged: string[]; changed: boolean } {
  const base = Array.isArray(existing) ? (existing.filter((x) => typeof x === "string") as string[]) : [];
  const set = new Set(base);
  let changed = false;
  for (const t of incoming) {
    if (t && !set.has(t)) { set.add(t); changed = true; }
  }
  return { merged: Array.from(set), changed };
}

/**
 * Processa as ENTRADAS (joins) de um grupo e cria/tagueia leads/clientes.
 * `groupIdDigits` = dígitos do JID do grupo (igual ao gravado em whatsapp_group_members).
 */
export async function captureVipGroupJoins(
  supabase: any,
  groupIdDigits: string,
  joins: VipJoin[],
): Promise<void> {
  try {
    if (!groupIdDigits || !joins.length) return;

    // 1) Mapeia os dígitos do grupo -> whatsapp_groups (pode haver 1 linha por instância).
    const { data: groupsRaw } = await supabase
      .from("whatsapp_groups")
      .select("id, group_id, name");
    const matching = (groupsRaw || []).filter(
      (g: AnyObj) => digitsOf(g.group_id) === groupIdDigits,
    );
    if (!matching.length) return; // grupo desconhecido → nada a fazer
    const groupUuids = matching.map((g: AnyObj) => g.id as string);
    const groupName =
      (matching.find((g: AnyObj) => (g.name as string))?.name as string) || "Grupo VIP";

    // 2) Campanhas VIP que contêm esse grupo. Sem campanha => não é fluxo de captação VIP.
    const { data: campaignsRaw } = await supabase
      .from("group_campaigns")
      .select("id, name, target_groups");
    const camps = (campaignsRaw || []).filter((c: AnyObj) =>
      Array.isArray(c.target_groups) &&
      (c.target_groups as string[]).some((id) => groupUuids.includes(id)),
    );
    if (!camps.length) return;
    const campaignNames = camps
      .map((c: AnyObj) => (c.name as string) || null)
      .filter(Boolean) as string[];
    const campaignIds = camps.map((c: AnyObj) => c.id as string);

    // Tags a aplicar (grupo + campanha(s)) — humanas e idempotentes.
    const tagsToApply = [
      `grupo:${groupName}`,
      ...campaignNames.map((n) => `campanha:${n}`),
    ];

    for (const j of joins) {
      const e164 = digitsOf(j.phone);
      if (e164.length < 12) continue; // sem telefone real (ex.: @lid) → ignora
      const suffix = last8(e164);

      // ── (a) JÁ É CLIENTE → só tagueia customers_unified (não cria lead) ──
      if (j.isCustomer && j.customerId) {
        try {
          const { data: cust } = await supabase
            .from("customers_unified")
            .select("id, tags")
            .eq("id", j.customerId)
            .maybeSingle();
          if (cust) {
            const { merged, changed } = uniqMerge(cust.tags, tagsToApply);
            if (changed) {
              await supabase.from("customers_unified").update({ tags: merged }).eq("id", cust.id);
            }
          }
        } catch (e) {
          console.error("[vip-lead-capture] tag cliente:", (e as Error).message);
        }
        continue;
      }

      // ── (b) NÃO é cliente → cria/atualiza LEAD no balde "Grupo VIP" ──
      try {
        // Idempotência: já existe lead com esse telefone? (qualquer balde lp_leads)
        const { data: existing } = await supabase
          .from("lp_leads")
          .select("id, metadata, name, campaign_tag")
          .ilike("phone", `%${suffix}`)
          .limit(5);

        // Prioriza um lead já no balde grupo-vip; senão qualquer lead existente.
        const existingLead =
          (existing || []).find((l: AnyObj) => (l.campaign_tag as string) === "grupo-vip") ||
          (existing || [])[0] ||
          null;

        if (existingLead) {
          // Só acrescenta as tags de grupo/campanha em metadata.vip_tags (sem duplicar).
          const meta: AnyObj = (existingLead.metadata as AnyObj) || {};
          const { merged: vipTags, changed } = uniqMerge(meta.vip_tags, tagsToApply);
          const gids = uniqMerge(meta.group_ids, [groupIdDigits]);
          const cids = uniqMerge(meta.campaign_ids, campaignIds);
          if (changed || gids.changed || cids.changed) {
            await supabase.from("lp_leads").update({
              name: (existingLead.name as string) || j.displayName || null,
              metadata: {
                ...meta,
                vip_tags: vipTags,
                group_ids: gids.merged,
                campaign_ids: cids.merged,
                captured_via: "group_join",
              },
            }).eq("id", existingLead.id);
          }
        } else {
          // Cria lead novo no MESMO balde do canal "Grupo VIP".
          await supabase.from("lp_leads").insert({
            source: "external_lead",
            campaign_tag: "grupo-vip",
            name: j.displayName || null,
            phone: e164,
            metadata: {
              vip_tags: tagsToApply,
              group_ids: [groupIdDigits],
              campaign_ids: campaignIds,
              captured_via: "group_join",
            },
          });
        }
      } catch (e) {
        console.error("[vip-lead-capture] upsert lead:", (e as Error).message);
      }
    }
  } catch (e) {
    console.error("[vip-lead-capture] erro geral:", (e as Error).message);
  }
}
