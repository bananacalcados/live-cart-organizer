import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const JOB_KEY = "organic_leads_backfill_status";
const PAGE_SIZE = 1000;
const INSERT_BATCH_SIZE = 100;

type BackfillJob = {
  status: "idle" | "processing" | "completed" | "failed";
  progress: number;
  stage: string;
  detail: string;
  totalPhones: number;
  customersExcluded: number;
  existingLeadsExcluded: number;
  inserted: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  requestedBy?: string;
};

const defaultJob = (): BackfillJob => ({
  status: "idle",
  progress: 0,
  stage: "idle",
  detail: "Nenhum backfill em execução.",
  totalPhones: 0,
  customersExcluded: 0,
  existingLeadsExcluded: 0,
  inserted: 0,
});

const normalizePhone = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
};

const phoneSuffix = (value: string | null | undefined) => {
  const normalized = normalizePhone(value);
  return normalized ? normalized.slice(-8) : null;
};

const campaignTagForDate = (isoDate: string) => {
  const contactDate = new Date(isoDate);
  const dayOfMonth = contactDate.getDate();
  const weekNum = dayOfMonth <= 7 ? 1 : dayOfMonth <= 14 ? 2 : dayOfMonth <= 21 ? 3 : 4;
  const mm = String(contactDate.getMonth() + 1).padStart(2, "0");
  const yy = String(contactDate.getFullYear()).slice(-2);
  return `contato-whats-${weekNum}-${mm}-${yy}`;
};

async function saveJob(supabase: ReturnType<typeof createClient>, job: BackfillJob) {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: JOB_KEY, value: job as unknown as Record<string, unknown> }, { onConflict: "key" });

  if (error) {
    console.error("Failed to persist backfill job:", error);
    throw error;
  }
}

async function loadJob(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", JOB_KEY)
    .maybeSingle();

  if (error) {
    console.error("Failed to load backfill job:", error);
    throw error;
  }

  return ((data?.value as BackfillJob | null) ?? defaultJob()) as BackfillJob;
}

async function fetchPhoneSuffixes(
  supabase: ReturnType<typeof createClient>,
  table: string,
  column: string,
  progressStart: number,
  progressEnd: number,
  stage: string,
  detailPrefix: string,
  updateJob: (patch: Partial<BackfillJob>) => Promise<void>,
) {
  const { count, error: countError } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .not(column, "is", null);

  if (countError) throw countError;

  const totalRows = count ?? 0;
  const suffixes = new Set<string>();
  let from = 0;
  let processedRows = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, "is", null)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data as Record<string, string | null>[]) {
      const suffix = phoneSuffix(row[column]);
      if (suffix) suffixes.add(suffix);
    }

    processedRows += data.length;
    from += PAGE_SIZE;

    const ratio = totalRows > 0 ? Math.min(processedRows / totalRows, 1) : 1;
    const progress = progressStart + Math.round((progressEnd - progressStart) * ratio);

    await updateJob({
      progress,
      stage,
      detail: `${detailPrefix}: ${processedRows.toLocaleString("pt-BR")} registros lidos`,
    });

    if (data.length < PAGE_SIZE) break;
  }

  await updateJob({
    progress: progressEnd,
    stage,
    detail: `${detailPrefix}: ${suffixes.size.toLocaleString("pt-BR")} telefones mapeados`,
  });

  return suffixes;
}

async function processBackfill(
  supabase: ReturnType<typeof createClient>,
  initialJob: BackfillJob,
) {
  let job = { ...initialJob };

  const updateJob = async (patch: Partial<BackfillJob>) => {
    job = { ...job, ...patch };
    await saveJob(supabase, job);
  };

  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const sinceISO = threeMonthsAgo.toISOString();

    await updateJob({
      progress: 1,
      stage: "Preparando",
      detail: `Lendo contatos desde ${sinceISO.slice(0, 10)}`,
      error: undefined,
      finishedAt: undefined,
    });

    const { count: totalIncomingRows, error: incomingCountError } = await supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "incoming")
      .eq("is_group", false)
      .gte("created_at", sinceISO);

    if (incomingCountError) throw incomingCountError;

    const allPhones = new Map<string, { name: string | null; latestContact: string }>();
    let from = 0;
    let processedIncomingRows = 0;

    while (true) {
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("phone, sender_name, created_at")
        .eq("direction", "incoming")
        .eq("is_group", false)
        .gte("created_at", sinceISO)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const message of data) {
        const phone = normalizePhone(message.phone);
        if (!phone) continue;

        if (!allPhones.has(phone)) {
          allPhones.set(phone, {
            name: message.sender_name || null,
            latestContact: message.created_at,
          });
        }
      }

      processedIncomingRows += data.length;
      from += PAGE_SIZE;

      const ratio = (totalIncomingRows ?? 0) > 0
        ? Math.min(processedIncomingRows / (totalIncomingRows ?? 1), 1)
        : 1;

      await updateJob({
        progress: Math.max(5, Math.round(ratio * 35)),
        stage: "Buscando contatos",
        detail: `${allPhones.size.toLocaleString("pt-BR")} telefones únicos encontrados até agora`,
        totalPhones: allPhones.size,
      });

      if (data.length < PAGE_SIZE) break;
    }

    await updateJob({
      progress: 35,
      stage: "Buscando contatos",
      detail: `${allPhones.size.toLocaleString("pt-BR")} telefones únicos encontrados`,
      totalPhones: allPhones.size,
    });

    const zoppySuffixes = await fetchPhoneSuffixes(
      supabase,
      "zoppy_customers",
      "phone",
      35,
      55,
      "Carregando clientes",
      "Base Zoppy",
      updateJob,
    );

    const posSuffixes = await fetchPhoneSuffixes(
      supabase,
      "pos_customers",
      "whatsapp",
      55,
      70,
      "Carregando clientes",
      "Base PDV",
      updateJob,
    );

    const knownCustomerSuffixes = new Set<string>([...zoppySuffixes, ...posSuffixes]);

    await updateJob({
      progress: 70,
      stage: "Filtrando clientes",
      detail: `${knownCustomerSuffixes.size.toLocaleString("pt-BR")} telefones de clientes conhecidos identificados`,
    });

    const existingLeadSuffixes = await fetchPhoneSuffixes(
      supabase,
      "lp_leads",
      "phone",
      70,
      82,
      "Carregando leads existentes",
      "Base de leads",
      updateJob,
    );

    let customersExcluded = 0;
    let existingLeadsExcluded = 0;
    const toInsert: Array<{
      name: string | null;
      phone: string;
      campaign_tag: string;
      source: string;
      converted: boolean;
      metadata: Record<string, unknown>;
    }> = [];

    let processedPhones = 0;
    const totalPhones = allPhones.size || 1;

    for (const [phone, info] of allPhones.entries()) {
      processedPhones += 1;
      const suffix = phoneSuffix(phone);
      if (!suffix) continue;

      if (knownCustomerSuffixes.has(suffix)) {
        customersExcluded += 1;
      } else if (existingLeadSuffixes.has(suffix)) {
        existingLeadsExcluded += 1;
      } else {
        toInsert.push({
          name: info.name,
          phone,
          campaign_tag: campaignTagForDate(info.latestContact),
          source: "organic_whatsapp_backfill",
          converted: false,
          metadata: {
            captured_at: info.latestContact,
            backfilled: true,
          },
        });
      }

      if (processedPhones % 500 === 0 || processedPhones === totalPhones) {
        await updateJob({
          progress: 82 + Math.round((processedPhones / totalPhones) * 8),
          stage: "Montando lotes",
          detail: `${toInsert.length.toLocaleString("pt-BR")} leads prontos para salvar`,
          customersExcluded,
          existingLeadsExcluded,
        });
      }
    }

    if (toInsert.length === 0) {
      await updateJob({
        status: "completed",
        progress: 100,
        stage: "Concluído",
        detail: "Nenhum novo lead orgânico precisava ser criado.",
        customersExcluded,
        existingLeadsExcluded,
        inserted: 0,
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    let inserted = 0;
    const totalBatches = Math.ceil(toInsert.length / INSERT_BATCH_SIZE);

    for (let index = 0; index < toInsert.length; index += INSERT_BATCH_SIZE) {
      const batch = toInsert.slice(index, index + INSERT_BATCH_SIZE);
      const { error } = await supabase.from("lp_leads").insert(batch as never);
      if (error) throw error;

      inserted += batch.length;
      const batchNumber = Math.floor(index / INSERT_BATCH_SIZE) + 1;

      await updateJob({
        progress: 90 + Math.round((inserted / toInsert.length) * 10),
        stage: "Salvando leads",
        detail: `Lote ${batchNumber}/${totalBatches}: ${inserted.toLocaleString("pt-BR")} leads salvos`,
        customersExcluded,
        existingLeadsExcluded,
        inserted,
      });
    }

    await updateJob({
      status: "completed",
      progress: 100,
      stage: "Concluído",
      detail: `Backfill finalizado com ${inserted.toLocaleString("pt-BR")} leads criados.`,
      customersExcluded,
      existingLeadsExcluded,
      inserted,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Backfill error:", error);
    await updateJob({
      status: "failed",
      stage: "Erro",
      detail: "Falha ao executar o backfill orgânico.",
      error: error instanceof Error ? error.message : "Erro desconhecido",
      finishedAt: new Date().toISOString(),
    });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let payload: { action?: string } = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const action = payload.action === "status" ? "status" : "start";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (action === "status") {
      const job = await loadJob(supabase);
      return new Response(JSON.stringify({ job }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const currentJob = await loadJob(supabase);
    if (currentJob.status === "processing") {
      return new Response(JSON.stringify({ job: currentJob, alreadyRunning: true }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nextJob: BackfillJob = {
      ...defaultJob(),
      status: "processing",
      progress: 1,
      stage: "Preparando",
      detail: "Iniciando backfill orgânico...",
      startedAt: new Date().toISOString(),
      requestedBy: authData.user.id,
    };

    await saveJob(supabase, nextJob);

    const backfillPromise = processBackfill(supabase, nextJob);
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;

    if (runtime?.waitUntil) {
      runtime.waitUntil(backfillPromise);
    } else {
      backfillPromise.catch(console.error);
    }

    return new Response(JSON.stringify({ job: nextJob, alreadyRunning: false }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Backfill request error:", error);
    return new Response(JSON.stringify({ error: "Internal server error", details: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});