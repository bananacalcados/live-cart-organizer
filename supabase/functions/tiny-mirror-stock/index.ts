import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Item = {
  adjustment_id: string;
  product_id: string;
  tiny_id: number;
  sku: string | null;
  new_stock: number;
  quantity: number;
  direction: "in" | "out";
};

async function mirrorOne(
  supabase: any,
  storeToken: string,
  depositName: string | null,
  saleId: string,
  saleEvent: string,
  it: Item,
): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    idProduto: Number(it.tiny_id),
    tipo: "B",
    quantidade: String(it.new_stock),
    observacoes: `Sale ${saleId} (${saleEvent}) ${it.direction}=${it.quantity}`,
  };
  if (depositName) payload.nome_deposito = depositName;

  const form = new URLSearchParams();
  form.set("token", storeToken);
  form.set("formato", "json");
  form.set("estoque", JSON.stringify({ estoque: payload }));

  const r = await fetch("https://api.tiny.com.br/api2/produto.atualizar.estoque.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await r.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { /* ignore */ }

  if (data?.retorno?.status === "Erro") {
    const nested = data?.retorno?.registros?.registro?.erros?.[0]?.erro;
    const top = data?.retorno?.erros?.[0]?.erro;
    return { ok: false, error: nested || top || text.slice(0, 200) };
  }

  return { ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const mode = body?.mode ?? "live"; // 'live' (chamada do trigger) | 'retry' (cron)

    // ============ MODO RETRY ============
    if (mode === "retry") {
      const { data: pending } = await supabase
        .from("tiny_stock_sync_errors")
        .select("*")
        .eq("status", "pending")
        .is("resolved_at", null)
        .lt("attempts", 5)
        .order("created_at", { ascending: true })
        .limit(50);

      const items = pending || [];
      const results: any[] = [];

      // Cache de tokens por loja
      const storeCache = new Map<string, { token: string; deposit: string | null }>();
      async function getStore(storeId: string) {
        if (storeCache.has(storeId)) return storeCache.get(storeId)!;
        const { data: s } = await supabase
          .from("pos_stores")
          .select("tiny_token, tiny_deposit_name")
          .eq("id", storeId)
          .single();
        const cfg = { token: s?.tiny_token ?? "", deposit: s?.tiny_deposit_name ?? null };
        storeCache.set(storeId, cfg);
        return cfg;
      }

      for (const err of items) {
        if (!err.store_id || !err.tiny_id) {
          await supabase.from("tiny_stock_sync_errors")
            .update({ status: "abandoned", last_attempt_at: new Date().toISOString() })
            .eq("id", err.id);
          continue;
        }
        const cfg = await getStore(err.store_id);
        if (!cfg.token) {
          await supabase.from("tiny_stock_sync_errors")
            .update({ status: "abandoned", last_attempt_at: new Date().toISOString(),
                      error_message: "Store has no tiny_token" })
            .eq("id", err.id);
          continue;
        }

        const fakeItem: Item = {
          adjustment_id: "",
          product_id: err.product_id,
          tiny_id: err.tiny_id,
          sku: err.sku,
          new_stock: Number(err.attempted_stock),
          quantity: Number(err.quantity),
          direction: err.direction,
        };

        const res = await mirrorOne(supabase, cfg.token, cfg.deposit,
                                    err.sale_id, err.sale_event ?? "sale", fakeItem);

        const newAttempts = (err.attempts ?? 1) + 1;
        if (res.ok) {
          await supabase.from("tiny_stock_sync_errors")
            .update({ status: "resolved", resolved_at: new Date().toISOString(),
                      attempts: newAttempts, last_attempt_at: new Date().toISOString() })
            .eq("id", err.id);
        } else {
          const finalStatus = newAttempts >= 5 ? "abandoned" : "pending";
          await supabase.from("tiny_stock_sync_errors")
            .update({ status: finalStatus, attempts: newAttempts,
                      last_attempt_at: new Date().toISOString(),
                      error_message: res.error })
            .eq("id", err.id);
        }
        results.push({ id: err.id, ok: res.ok });
      }

      return new Response(JSON.stringify({ ok: true, mode: "retry", processed: results.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============ MODO LIVE (trigger) ============
    const { sale_id, store_id, sale_event, items } = body as {
      sale_id: string; store_id: string; sale_event: string; items: (Item & { store_id?: string })[];
    };

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A baixa pode sair de lojas DIFERENTES (estoque compartilhado), então
    // resolvemos token/depósito por loja de cada item (fallback no store_id topo).
    const storeCache = new Map<string, { token: string; deposit: string | null }>();
    async function getStore(sid: string) {
      if (storeCache.has(sid)) return storeCache.get(sid)!;
      const { data: s } = await supabase
        .from("pos_stores")
        .select("tiny_token, tiny_deposit_name")
        .eq("id", sid)
        .maybeSingle();
      const cfg = { token: s?.tiny_token ?? "", deposit: s?.tiny_deposit_name ?? null };
      storeCache.set(sid, cfg);
      return cfg;
    }

    const results: any[] = [];
    for (const it of items) {
      const itemStore = it.store_id || store_id;
      const cfg = itemStore ? await getStore(itemStore) : { token: "", deposit: null };

      if (!cfg.token) {
        // Loja sem integração Tiny — marca como ok (estoque local já é a fonte da verdade)
        if (it.adjustment_id) {
          await supabase.from("pos_stock_adjustments")
            .update({ tiny_mirror_status: "ok", tiny_mirrored_at: new Date().toISOString() })
            .eq("id", it.adjustment_id);
        }
        results.push({ adjustment_id: it.adjustment_id, ok: true, no_token: true });
        continue;
      }

      const res = await mirrorOne(supabase, cfg.token, cfg.deposit, sale_id, sale_event, it);
      if (res.ok) {
        await supabase.from("pos_stock_adjustments")
          .update({ tiny_mirror_status: "ok", tiny_mirrored_at: new Date().toISOString() })
          .eq("id", it.adjustment_id);
      } else {
        await supabase.from("pos_stock_adjustments")
          .update({ tiny_mirror_status: "error" })
          .eq("id", it.adjustment_id);
        await supabase.from("tiny_stock_sync_errors").insert({
          sale_id, product_id: it.product_id, store_id: itemStore,
          tiny_id: it.tiny_id, sku: it.sku,
          attempted_stock: it.new_stock,
          direction: it.direction, quantity: it.quantity,
          sale_event, error_message: res.error,
        });
      }
      results.push({ adjustment_id: it.adjustment_id, ok: res.ok, error: res.error });
    }

    return new Response(JSON.stringify({ ok: true, mode: "live", results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("tiny-mirror-stock error", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
