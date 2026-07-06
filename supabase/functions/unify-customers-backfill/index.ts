// Backfill de unificação de clientes — Fase 2
// Modo padrão: dry-run (apenas relatório). Para gravar: { mode: "execute" }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SourceRow = {
  origin: string;        // ex: "zoppy:abc-123"
  name?: string | null;
  cpf?: string | null;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  instagram_handle?: string | null;
  instagram_user_id?: string | null;
  cep?: string | null;
  address?: string | null;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  shoe_size?: string | null;
  preferred_style?: string | null;
  age_range?: string | null;
  has_children?: boolean | null;
  children_age_range?: string | null;
  total_orders?: number | null;
  total_spent?: number | null;
  avg_ticket?: number | null;
  first_purchase_at?: string | null;
  last_purchase_at?: string | null;
  rfm_segment?: string | null;
  rfm_r?: number | null;
  rfm_f?: number | null;
  rfm_m?: number | null;
  rfm_total?: number | null;
  region_type?: string | null;
  ddd?: string | null;
  tags?: string[] | null;
  is_banned?: boolean | null;
  ban_reason?: string | null;
  live_cancellation_count?: number | null;
  list_id?: string | null; // p/ marketing_contacts
};

const normPhone = (raw?: string | null) => {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d || d.length < 10) return null;
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  // injeta 9º dígito quando 10 (celular antigo)
  if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2);
  return "55" + d;
};
const phoneSuffix8 = (e164: string | null) => (e164 ? e164.slice(-8) : null);
const normCpf = (raw?: string | null) => {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length === 11 ? d : null;
};
const normEmail = (raw?: string | null) => (raw ? raw.trim().toLowerCase() || null : null);
const normIg = (raw?: string | null) => {
  if (!raw) return null;
  return raw.toLowerCase().replace(/^@/, "").trim() || null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const mode: "dry-run" | "execute" = body.mode === "execute" ? "execute" : "dry-run";
    const onlySources: string[] | null = Array.isArray(body.sources) ? body.sources : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const log: string[] = [];
    const push = (m: string) => { console.log(m); log.push(m); };

    push(`🚀 Backfill iniciado | modo=${mode} | sources=${onlySources?.join(",") || "ALL"}`);

    // ---------- 1) Carrega TODAS as fontes em memória, normaliza ----------
    const sources: { name: string; rows: SourceRow[] }[] = [];

    const fetchAll = async (table: string, select: string, mapper: (r: any) => SourceRow): Promise<SourceRow[]> => {
      const out: SourceRow[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await supabase.from(table).select(select).range(from, from + step - 1);
        if (error) { push(`⚠️ ${table}: ${error.message}`); break; }
        if (!data || data.length === 0) break;
        out.push(...data.map(mapper));
        if (data.length < step) break;
        from += step;
      }
      push(`📥 ${table}: ${out.length} linhas carregadas`);
      return out;
    };

    if (!onlySources || onlySources.includes("zoppy_customers")) {
      sources.push({
        name: "zoppy_customers",
        rows: await fetchAll(
          "zoppy_customers",
          "id, first_name, last_name, cpf, email, phone, gender, birth_date, address1, address2, city, state, postcode, shoe_size, preferred_style, age_range, total_orders, total_spent, avg_ticket, first_purchase_at, last_purchase_at, rfm_segment, rfm_recency_score, rfm_frequency_score, rfm_monetary_score, rfm_total_score, region_type, ddd, cashback_balance, cashback_expires_at",
          (r: any) => ({
            origin: `zoppy:${r.id}`,
            name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || null,
            cpf: normCpf(r.cpf),
            email: normEmail(r.email),
            phone: normPhone(r.phone),
            birth_date: r.birth_date,
            gender: r.gender,
            address: r.address1,
            complement: r.address2,
            city: r.city,
            state: r.state,
            cep: r.postcode,
            shoe_size: r.shoe_size,
            preferred_style: r.preferred_style,
            age_range: r.age_range,
            total_orders: r.total_orders,
            total_spent: r.total_spent,
            avg_ticket: r.avg_ticket,
            first_purchase_at: r.first_purchase_at,
            last_purchase_at: r.last_purchase_at,
            rfm_segment: r.rfm_segment,
            rfm_r: r.rfm_recency_score,
            rfm_f: r.rfm_frequency_score,
            rfm_m: r.rfm_monetary_score,
            rfm_total: r.rfm_total_score,
            region_type: r.region_type,
            ddd: r.ddd,
            cashback_balance: r.cashback_balance,
            cashback_expires_at: r.cashback_expires_at,
          }),
        ),
      });
    }

    if (!onlySources || onlySources.includes("pos_customers")) {
      sources.push({
        name: "pos_customers",
        rows: await fetchAll(
          "pos_customers",
          "id, name, email, whatsapp, cpf, cep, address, address_number, complement, neighborhood, city, state, age_range, preferred_style, shoe_size, gender, has_children, children_age_range",
          (r: any) => ({
            origin: `pos:${r.id}`,
            name: r.name,
            cpf: normCpf(r.cpf),
            email: normEmail(r.email),
            phone: normPhone(r.whatsapp),
            gender: r.gender,
            cep: r.cep, address: r.address, address_number: r.address_number,
            complement: r.complement, neighborhood: r.neighborhood, city: r.city, state: r.state,
            age_range: r.age_range, preferred_style: r.preferred_style, shoe_size: r.shoe_size,
            has_children: r.has_children, children_age_range: r.children_age_range,
          }),
        ),
      });
    }

    if (!onlySources || onlySources.includes("customer_registrations")) {
      sources.push({
        name: "customer_registrations",
        rows: await fetchAll(
          "customer_registrations",
          "id, full_name, cpf, email, whatsapp, cep, address, address_number, complement, neighborhood, city, state",
          (r: any) => ({
            origin: `reg:${r.id}`,
            name: r.full_name, cpf: normCpf(r.cpf), email: normEmail(r.email), phone: normPhone(r.whatsapp),
            cep: r.cep, address: r.address, address_number: r.address_number,
            complement: r.complement, neighborhood: r.neighborhood, city: r.city, state: r.state,
          }),
        ),
      });
    }

    if (!onlySources || onlySources.includes("customers")) {
      sources.push({
        name: "customers",
        rows: await fetchAll(
          "customers",
          "id, instagram_handle, whatsapp, is_banned, ban_reason, tags, live_cancellation_count",
          (r: any) => ({
            origin: `cust:${r.id}`,
            instagram_handle: normIg(r.instagram_handle),
            phone: normPhone(r.whatsapp),
            is_banned: r.is_banned, ban_reason: r.ban_reason,
            tags: r.tags, live_cancellation_count: r.live_cancellation_count,
          }),
        ),
      });
    }

    if (!onlySources || onlySources.includes("ravena_customers")) {
      sources.push({
        name: "ravena_customers",
        rows: await fetchAll(
          "ravena_customers",
          "id, name, phone, email, city, state, ddd, rfm_segment, rfm_r, rfm_f, rfm_m, rfm_total, total_orders, total_spent, avg_ticket, first_purchase_at, last_purchase_at, tags",
          (r: any) => ({
            origin: `rav:${r.id}`,
            name: r.name, email: normEmail(r.email), phone: normPhone(r.phone),
            city: r.city, state: r.state, ddd: r.ddd,
            rfm_segment: r.rfm_segment, rfm_r: r.rfm_r, rfm_f: r.rfm_f, rfm_m: r.rfm_m, rfm_total: r.rfm_total,
            total_orders: r.total_orders, total_spent: r.total_spent, avg_ticket: r.avg_ticket,
            first_purchase_at: r.first_purchase_at, last_purchase_at: r.last_purchase_at, tags: r.tags,
          }),
        ),
      });
    }

    if (!onlySources || onlySources.includes("chat_contacts")) {
      sources.push({
        name: "chat_contacts",
        rows: await fetchAll(
          "chat_contacts",
          "id, phone, display_name, custom_name, tags",
          (r: any) => ({
            origin: `chat:${r.id}`,
            name: r.custom_name || r.display_name, phone: normPhone(r.phone), tags: r.tags,
          }),
        ),
      });
    }

    if (!onlySources || onlySources.includes("instagram_user_links")) {
      sources.push({
        name: "instagram_user_links",
        rows: await fetchAll(
          "instagram_user_links",
          "id, username, ig_user_id",
          (r: any) => ({
            origin: `igl:${r.id}`,
            instagram_handle: normIg(r.username),
            instagram_user_id: r.ig_user_id,
          }),
        ),
      });
    }

    if (!onlySources || onlySources.includes("marketing_contacts")) {
      sources.push({
        name: "marketing_contacts",
        rows: await fetchAll(
          "marketing_contacts",
          "id, list_id, name, phone, email, instagram, tags",
          (r: any) => ({
            origin: `mkt:${r.id}`,
            name: r.name, email: normEmail(r.email), phone: normPhone(r.phone),
            instagram_handle: normIg(r.instagram), tags: r.tags, list_id: r.list_id,
          }),
        ),
      });
    }

    // ---------- 2) Dedupe em memória ----------
    type Unified = SourceRow & { _origins: string[]; _list_ids: Set<string> };
    const unifiedById = new Map<string, Unified>(); // key arbitrário interno
    const byCpf = new Map<string, string>();
    const byPhoneFull = new Map<string, string>(); // E.164 completo
    const byPhoneSuf = new Map<string, string>();  // sufixo 8
    const byEmail = new Map<string, string>();
    const byIg = new Map<string, string>();

    let created = 0;
    let merged = 0;
    const conflicts: string[] = [];

    const mergeFields = (target: Unified, src: SourceRow) => {
      const prefer = <K extends keyof SourceRow>(k: K) => {
        if ((target[k] === null || target[k] === undefined || target[k] === "") && src[k] !== null && src[k] !== undefined && src[k] !== "") {
          (target as any)[k] = src[k];
        }
      };
      const numericMax = <K extends keyof SourceRow>(k: K) => {
        const a = Number(target[k] || 0); const b = Number(src[k] || 0);
        if (b > a) (target as any)[k] = b;
      };
      const dateEarliest = <K extends keyof SourceRow>(k: K) => {
        if (!src[k]) return;
        if (!target[k] || String(src[k]) < String(target[k])) (target as any)[k] = src[k];
      };
      const dateLatest = <K extends keyof SourceRow>(k: K) => {
        if (!src[k]) return;
        if (!target[k] || String(src[k]) > String(target[k])) (target as any)[k] = src[k];
      };

      // NOTA: "cpf" NÃO entra aqui de propósito. CPF é identidade forte e só pode
      // ser adotado por um match de CPF ou na criação do registro. Adotar CPF num
      // match por telefone/email/IG contamina a ficha com o CPF de outra pessoa
      // (ex.: alguém digitou o CPF do cliente A no telefone do cliente B).
      ["name","email","birth_date","gender","instagram_handle","instagram_user_id",
       "cep","address","address_number","complement","neighborhood","city","state",
       "shoe_size","preferred_style","age_range","children_age_range",
       "rfm_segment","region_type","ddd","ban_reason"].forEach((k) => prefer(k as any));

      if (src.phone && !target.phone) target.phone = src.phone;
      if (src.has_children !== null && src.has_children !== undefined) target.has_children = target.has_children || src.has_children;
      if (src.is_banned) target.is_banned = true;

      numericMax("total_orders" as any);
      numericMax("total_spent" as any);
      numericMax("total_items" as any);
      numericMax("live_cancellation_count" as any);
      numericMax("rfm_r" as any); numericMax("rfm_f" as any); numericMax("rfm_m" as any); numericMax("rfm_total" as any);

      dateEarliest("first_purchase_at" as any);
      dateLatest("last_purchase_at" as any);

      // cashback: usa o maior saldo e a data de expiração mais distante
      numericMax("cashback_balance" as any);
      dateLatest("cashback_expires_at" as any);

      if (src.tags?.length) {
        const set = new Set([...(target.tags || []), ...src.tags]);
        target.tags = [...set];
      }

      target._origins.push(src.origin);
      if (src.list_id) target._list_ids.add(src.list_id);
    };

    const indexKeys = (id: string, u: Unified) => {
      if (u.cpf) byCpf.set(u.cpf, id);
      if (u.phone) byPhoneFull.set(u.phone, id);
      const suf = phoneSuffix8(u.phone || null);
      if (suf) byPhoneSuf.set(suf, id);
      if (u.email) byEmail.set(u.email, id);
      if (u.instagram_handle) byIg.set(u.instagram_handle, id);
    };

    let internalSeq = 0;
    for (const src of sources) {
      for (const row of src.rows) {
        // Match cascade — CPF é identidade FORTE; telefone/email/IG são fracos.
        const suf = phoneSuffix8(row.phone || null);
        const cpfMatch = row.cpf ? byCpf.get(row.cpf) : undefined;
        const weakMatch =
          (row.phone && byPhoneFull.get(row.phone)) ||
          (suf && byPhoneSuf.get(suf)) ||
          (row.email && byEmail.get(row.email)) ||
          (row.instagram_handle && byIg.get(row.instagram_handle)) || undefined;

        // Cria uma identidade isolada para o CPF do row (sem telefone p/ não
        // re-colidir). Usado quando o CPF não pode ser fundido no match fraco.
        const createIsolated = () => {
          const id = `tmp-${++internalSeq}`;
          const isolated: Unified = { ...row, phone: null, _origins: [row.origin], _list_ids: new Set(row.list_id ? [row.list_id] : []) };
          unifiedById.set(id, isolated);
          if (isolated.cpf) byCpf.set(isolated.cpf, id);
          if (isolated.email) byEmail.set(isolated.email, id);
          if (isolated.instagram_handle) byIg.set(isolated.instagram_handle, id);
          created++;
        };

        if (cpfMatch) {
          // Mesma identidade confirmada por CPF → fusão segura.
          const u = unifiedById.get(cpfMatch)!;
          mergeFields(u, row);
          if (!u.cpf) u.cpf = row.cpf!;
          indexKeys(cpfMatch, u);
          merged++;
        } else if (weakMatch) {
          const u = unifiedById.get(weakMatch)!;
          if (row.cpf && u.cpf !== row.cpf) {
            // Telefone/email/IG batem, mas o CPF é de OUTRA pessoa (ou a ficha de
            // contato ainda não tem CPF). O CPF manda: NÃO contaminamos o registro
            // de contato — criamos uma identidade própria para o CPF.
            conflicts.push(`CPF '${row.cpf}' NÃO adotado em ${weakMatch} (alvo cpf=${u.cpf ?? "null"}) — criado como identidade independente (${row.origin})`);
            createIsolated();
          } else {
            // Sem CPF no row (apenas enriquecendo contato) ou CPF idêntico → seguro.
            mergeFields(u, row);
            indexKeys(weakMatch, u);
            merged++;
          }
        } else {
          const id = `tmp-${++internalSeq}`;
          const u: Unified = { ...row, _origins: [row.origin], _list_ids: new Set(row.list_id ? [row.list_id] : []) };
          unifiedById.set(id, u);
          indexKeys(id, u);
          created++;
        }
      }
    }

    push(`✅ Unificação em memória concluída: ${unifiedById.size} clientes únicos | ${created} criados | ${merged} merges`);
    push(`⚠️ Conflitos CPF: ${conflicts.length}`);

    // Estatísticas
    let withCpf = 0, withPhone = 0, withEmail = 0, withIg = 0, withBirth = 0, withAddress = 0;
    let totalMemberships = 0;
    for (const u of unifiedById.values()) {
      if (u.cpf) withCpf++;
      if (u.phone) withPhone++;
      if (u.email) withEmail++;
      if (u.instagram_handle) withIg++;
      if (u.birth_date) withBirth++;
      if (u.address) withAddress++;
      totalMemberships += u._list_ids.size;
    }

    const report = {
      mode,
      sources_loaded: sources.map((s) => ({ name: s.name, rows: s.rows.length })),
      total_rows_processed: created + merged,
      unique_customers: unifiedById.size,
      created_new: created,
      merged_into_existing: merged,
      cpf_conflicts: conflicts.length,
      coverage: {
        with_cpf: withCpf, with_phone: withPhone, with_email: withEmail,
        with_instagram: withIg, with_birth_date: withBirth, with_address: withAddress,
      },
      list_memberships_to_create: totalMemberships,
      sample_conflicts: conflicts.slice(0, 10),
    };

    if (mode === "dry-run") {
      push(`📊 DRY-RUN concluído — nada gravado. Use { "mode": "execute" } para escrever.`);
      return new Response(JSON.stringify({ ok: true, report, log }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- 3) EXECUTE: UPSERT IDEMPOTENTE em customers_unified ----------
    // NUNCA faz INSERT cego. Cada registro passa pelo RPC unify_upsert_customers,
    // que resolve a identidade canônica (CPF/telefone BR/e-mail/Instagram) via
    // find_or_create_unified_customer — com a blindagem de grupos/IG/LID — e só
    // então complementa lacunas. Rodar de novo NÃO clona a base: encontra o
    // mesmo registro e apenas reenriquece. Se estourar o tempo, pode ser
    // re-executado com segurança (idempotente) para continuar de onde parou.
    push(`💾 Iniciando UPSERT idempotente em customers_unified...`);
    const ids = [...unifiedById.keys()];
    const originToId = new Map<string, string>(); // source_origins[0] → uuid real
    const BATCH = 200;
    const startedAt = Date.now();
    const TIME_BUDGET_MS = 130_000; // margem antes do timeout do edge runtime
    let processed = 0;
    let skippedNoIdentity = 0;
    let partial = false;

    for (let i = 0; i < ids.length; i += BATCH) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        partial = true;
        push(`⏱️ Orçamento de tempo atingido em ${processed}/${ids.length}. Re-execute { "mode": "execute" } para continuar (idempotente).`);
        break;
      }
      const slice = ids.slice(i, i + BATCH);
      const records = slice.map((tmp) => {
        const u = unifiedById.get(tmp)!;
        return {
          name: u.name ?? null,
          cpf: u.cpf ?? null,
          email: u.email ?? null,
          birth_date: u.birth_date ?? null,
          gender: u.gender ?? null,
          phone_e164: u.phone ?? null,
          instagram_handle: u.instagram_handle ?? null,
          instagram_user_id: u.instagram_user_id ?? null,
          cep: u.cep ?? null, address: u.address ?? null, address_number: u.address_number ?? null,
          complement: u.complement ?? null, neighborhood: u.neighborhood ?? null, city: u.city ?? null, state: u.state ?? null,
          shoe_size: u.shoe_size ?? null, preferred_style: u.preferred_style ?? null, age_range: u.age_range ?? null,
          has_children: u.has_children ?? null, children_age_range: u.children_age_range ?? null,
          total_orders: u.total_orders ?? null,
          total_spent: u.total_spent ?? null,
          avg_ticket: u.avg_ticket ?? null,
          first_purchase_at: u.first_purchase_at ?? null,
          last_purchase_at: u.last_purchase_at ?? null,
          rfm_segment: u.rfm_segment ?? null, rfm_r: u.rfm_r ?? null, rfm_f: u.rfm_f ?? null, rfm_m: u.rfm_m ?? null, rfm_total: u.rfm_total ?? null,
          region_type: u.region_type ?? null, ddd: u.ddd ?? null,
          tags: u.tags ?? [],
          is_banned: u.is_banned ?? null, ban_reason: u.ban_reason ?? null,
          live_cancellation_count: u.live_cancellation_count ?? null,
          cashback_balance: u.cashback_balance ?? null,
          cashback_expires_at: u.cashback_expires_at ?? null,
          source_origins: u._origins,
        };
      });

      const { data, error } = await supabase.rpc("unify_upsert_customers", { p_records: records });
      if (error) {
        push(`❌ Lote ${i}: ${error.message}`);
        return new Response(JSON.stringify({ ok: false, error: error.message, log }, null, 2), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const mapped: { origin: string; id: string }[] = Array.isArray(data) ? data : [];
      for (const m of mapped) if (m?.origin && m?.id) originToId.set(m.origin, m.id);
      skippedNoIdentity += slice.length - mapped.length;
      processed += slice.length;
      push(`  processados ${Math.min(processed, ids.length)}/${ids.length}`);
    }

    // Memberships (idempotente via UNIQUE customer_id+list_id).
    const memberships: { customer_id: string; list_id: string }[] = [];
    for (const u of unifiedById.values()) {
      const realId = originToId.get(u._origins[0]);
      if (!realId) continue; // não resolvido (sem identidade) ou ainda não processado
      for (const list_id of u._list_ids) memberships.push({ customer_id: realId, list_id });
    }
    for (let i = 0; i < memberships.length; i += 500) {
      const slice = memberships.slice(i, i + 500);
      const { error } = await supabase
        .from("customer_list_memberships")
        .upsert(slice, { onConflict: "customer_id,list_id", ignoreDuplicates: true });
      if (error) push(`⚠️ memberships lote ${i}: ${error.message}`);
    }
    push(`🔗 ${memberships.length} vínculos cliente↔lista garantidos`);
    push(`✅ Upsert concluído | processados=${processed} | sem_identidade_ignorados=${skippedNoIdentity} | parcial=${partial}`);

    (report as Record<string, unknown>).execute = {
      processed,
      skipped_no_identity: skippedNoIdentity,
      partial,
      memberships: memberships.length,
    };


    return new Response(JSON.stringify({ ok: true, report, log }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
