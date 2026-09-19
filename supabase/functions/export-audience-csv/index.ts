import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SINCE = "2026-03-01";

function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("55")) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2);
  return "55" + d;
}

function splitName(name: string | null | undefined): [string, string] {
  const n = (name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return ["", ""];
  const parts = n.split(" ");
  return [parts[0], parts.length > 1 ? parts[parts.length - 1] : ""];
}

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Meta pede dob em YYYYMMDD. */
function normDob(raw: string | null | undefined): string {
  const v = String(raw || "").trim();
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : "";
}

function normGender(raw: string | null | undefined): string {
  const v = String(raw || "").trim().toLowerCase();
  if (v.startsWith("f")) return "f";
  if (v.startsWith("m")) return "m";
  return "";
}

function normState(raw: string | null | undefined): string {
  return String(raw || "").trim().toLowerCase().slice(0, 2);
}

function normCity(raw: string | null | undefined): string {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normZip(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length === 8 ? d : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: secretRow } = await supabase
    .from("internal_function_secrets")
    .select("value")
    .eq("key", "cron_secret")
    .maybeSingle();
  const provided = req.headers.get("x-cron-secret") || "";
  if (!secretRow?.value || provided !== secretRow.value) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const list = url.searchParams.get("list") || "physical";

  // ---- helpers -------------------------------------------------------
  type Rec = {
    phone: string;
    email: string;
    fn: string;
    ln: string;
    dob: string;
    gen: string;
    ct: string;
    st: string;
    zip: string;
    external_id: string;
    orders: string;
    spent: string;
    last_purchase: string;
    segment: string;
  };
  const blank = (phone: string): Rec => ({
    phone, email: "", fn: "", ln: "", dob: "", gen: "", ct: "", st: "", zip: "",
    external_id: "", orders: "", spent: "", last_purchase: "", segment: "",
  });
  const out = new Map<string, Rec>();
  const add = (phone: string | null, name?: string | null, email?: string | null) => {
    const p = normPhone(phone);
    if (!p) return;
    const [fn, ln] = splitName(name);
    const prev = out.get(p);
    const e = (email || "").trim().toLowerCase();
    if (!prev) {
      const rec = blank(p);
      rec.email = e; rec.fn = fn; rec.ln = ln;
      out.set(p, rec);
    } else {
      if (!prev.email && e) prev.email = e;
      if (!prev.fn && fn) { prev.fn = fn; prev.ln = ln; }
    }
  };

  async function pageAll<T>(
    build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    const all: T[] = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await build(from, from + size - 1);
      if (error) throw error;
      const rows = data || [];
      all.push(...rows);
      if (rows.length < size) break;
      if (all.length > 400000) break;
    }
    return all;
  }

  /** Completa cada contato com a ficha do CRM (casamento por 8 dígitos). */
  async function enrich() {
    const bySuffix = new Map<string, Rec[]>();
    for (const rec of out.values()) {
      const s = rec.phone.slice(-8);
      const arr = bySuffix.get(s);
      if (arr) arr.push(rec);
      else bySuffix.set(s, [rec]);
    }
    const suffixes = [...bySuffix.keys()];
    for (let i = 0; i < suffixes.length; i += 300) {
      const chunk = suffixes.slice(i, i + 300);
      const { data } = await supabase
        .from("customers_unified")
        .select(
          "customer_code, name, email, birth_date, gender, city, state, cep, phone_suffix8, total_orders, total_spent, last_purchase_at, rfm_segment",
        )
        .in("phone_suffix8", chunk)
        .is("merged_into_id", null);
      (data || []).forEach((c: Record<string, string | number | null>) => {
        const recs = bySuffix.get(String(c.phone_suffix8 || ""));
        if (!recs) return;
        for (const rec of recs) {
          if (!rec.email && c.email) rec.email = String(c.email).trim().toLowerCase();
          if (!rec.fn && c.name) {
            const [fn, ln] = splitName(String(c.name));
            rec.fn = fn; rec.ln = ln;
          }
          if (!rec.dob) rec.dob = normDob(c.birth_date as string);
          if (!rec.gen) rec.gen = normGender(c.gender as string);
          if (!rec.ct) rec.ct = normCity(c.city as string);
          if (!rec.st) rec.st = normState(c.state as string);
          if (!rec.zip) rec.zip = normZip(c.cep as string);
          if (!rec.external_id && c.customer_code) rec.external_id = String(c.customer_code);
          if (!rec.orders && c.total_orders != null) rec.orders = String(c.total_orders);
          if (!rec.spent && c.total_spent != null) rec.spent = String(c.total_spent);
          if (!rec.last_purchase && c.last_purchase_at) {
            rec.last_purchase = String(c.last_purchase_at).slice(0, 10);
          }
          if (!rec.segment && c.rfm_segment) rec.segment = String(c.rfm_segment);
        }
      });
    }
  }

  const salesSelect = "customer_phone, customer_name, customer_id, sale_type, created_at";

  try {
    if (list === "physical" || list === "online" || list === "buyers_all") {
      const types = list === "physical"
        ? ["physical"]
        : list === "online"
        ? ["online", "live"]
        : ["physical", "online", "live"];
      const rows = await pageAll<Record<string, string>>((f, t) =>
        supabase
          .from("pos_sales")
          .select(salesSelect)
          .in("sale_type", types)
          .in("status", ["paid", "completed", "pending_pickup", "pending_sync"])
          .eq("status_cancelamento", "ativo")
          .gte("created_at", SINCE)
          .order("created_at", { ascending: true })
          .range(f, t)
      );
      const missing = new Map<string, string>(); // customer_id -> name
      rows.forEach((r) => {
        if (normPhone(r.customer_phone)) add(r.customer_phone, r.customer_name);
        else if (r.customer_id) missing.set(r.customer_id, r.customer_name);
      });
      const ids = [...missing.keys()];
      for (let i = 0; i < ids.length; i += 300) {
        const chunk = ids.slice(i, i + 300);
        const { data } = await supabase
          .from("pos_customers")
          .select("id, name, email, whatsapp, cpf")
          .in("id", chunk);
        (data || []).forEach((c: Record<string, string>) =>
          add(c.whatsapp, c.name || missing.get(c.id), c.email)
        );
      }
      // Compradores importados/legados: o CRM já sabe que compraram no período.
      if (list === "buyers_all") {
        const legacy = await pageAll<Record<string, string>>((f, t) =>
          supabase
            .from("customers_unified")
            .select("phone_e164, name, email, last_purchase_at")
            .not("phone_e164", "is", null)
            .gte("last_purchase_at", SINCE)
            .is("merged_into_id", null)
            .order("phone_e164", { ascending: true })
            .range(f, t)
        );
        legacy.forEach((r) => add(r.phone_e164, r.name, r.email));
      }
    } else if (list === "all_customers") {
      const rows = await pageAll<Record<string, string>>((f, t) =>
        supabase
          .from("customers_unified")
          .select("phone_e164, name, email")
          .not("phone_e164", "is", null)
          .is("merged_into_id", null)
          .order("phone_e164", { ascending: true })
          .range(f, t)
      );
      rows.forEach((r) => add(r.phone_e164, r.name, r.email));
    } else if (list === "leads_no_purchase") {
      const buyers = new Set<string>();
      const sales = await pageAll<Record<string, string>>((f, t) =>
        supabase
          .from("pos_sales")
          .select("customer_phone")
          .eq("status_cancelamento", "ativo")
          .not("customer_phone", "is", null)
          .order("customer_phone", { ascending: true })
          .range(f, t)
      );
      sales.forEach((r) => {
        const p = normPhone(r.customer_phone);
        if (p) buyers.add(p.slice(-8));
      });

      const leadTables: Array<[string, string, string, string | null]> = [
        ["lp_leads", "phone", "name", "email"],
        ["event_leads", "phone", "name", null],
        ["ad_leads", "phone", "name", null],
        ["link_page_leads", "phone", "name", null],
        ["campaign_leads", "phone", "name", "email"],
      ];
      for (const [table, pc, nc, ec] of leadTables) {
        const cols = [pc, nc, ec].filter(Boolean).join(", ");
        const rows = await pageAll<Record<string, string>>((f, t) =>
          supabase.from(table).select(cols).not(pc, "is", null).order(pc, { ascending: true }).range(f, t) as never
        );
        rows.forEach((r) => {
          const p = normPhone(r[pc]);
          if (!p || buyers.has(p.slice(-8))) return;
          add(p, r[nc], ec ? r[ec] : null);
        });
      }
    } else {
      return new Response("unknown list", { status: 400, headers: corsHeaders });
    }

    await enrich();

    const lines = [
      "phone,email,fn,ln,dob,gen,ct,st,zip,country,external_id,pedidos,total_gasto,ultima_compra,segmento",
    ];
    for (const r of out.values()) {
      lines.push([
        r.phone, r.email, r.fn, r.ln, r.dob, r.gen, r.ct, r.st, r.zip, "br",
        r.external_id, r.orders, r.spent, r.last_purchase, r.segment,
      ].map(csvEscape).join(","));
    }
    return new Response(lines.join("\n"), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "x-row-count": String(out.size),
      },
    });
  } catch (e) {
    return new Response(`error: ${String((e as Error)?.message || e)}`, {
      status: 500,
      headers: corsHeaders,
    });
  }
});
