// Edge: fiscal-backfill-xml
// Recupera xml_content (e DANFE) de notas já autorizadas cuja resposta da
// BrasilNFe foi salva mas nunca decodificada — caso das NFC-e (modelo 65)
// emitidas antes da correção do nfce-emitir.
//
// Body (todos opcionais):
//   { modelo?: 55 | 65, from?: "2026-07-01", to?: "2026-09-01", limit?: 200, dry_run?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { persistFiscalFiles } from "../_shared/fiscal-persist-files.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUTHORIZED = ["authorized", "autorizada", "autorizado"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const modelo = body.modelo ? Number(body.modelo) : null;
    const from = body.from || null;
    const to = body.to || null;
    const limit = Math.min(Number(body.limit) || 200, 500);
    const dryRun = body.dry_run === true;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = supabase
      .from("fiscal_documents")
      .select("id, numero, serie, modelo, chave_acesso, xml_content, danfe_url, brasilnfe_response, created_at")
      .in("status", AUTHORIZED)
      .is("xml_content", null)
      .not("brasilnfe_response", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (modelo) q = q.eq("modelo", modelo);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lt("created_at", to);

    const { data: docs, error } = await q;
    if (error) throw error;

    const result = {
      scanned: docs?.length || 0,
      recovered_xml: 0,
      recovered_danfe: 0,
      no_data: [] as Array<{ id: string; numero: number | null }>,
      failed: [] as Array<{ id: string; error: string }>,
      dry_run: dryRun,
    };

    for (const doc of docs || []) {
      try {
        const resp: any = doc.brasilnfe_response || {};
        const files = await (dryRun
          ? Promise.resolve({
              xml_content: resp.Base64Xml ? "(dry-run)" : undefined,
              danfe_url: resp.Base64File ? "(dry-run)" : undefined,
            })
          : persistFiscalFiles(supabase, resp, doc.chave_acesso));

        const updates: Record<string, any> = {};
        if (files.xml_content) updates.xml_content = files.xml_content;
        if (files.danfe_url && !doc.danfe_url) updates.danfe_url = files.danfe_url;

        if (!Object.keys(updates).length) {
          result.no_data.push({ id: doc.id, numero: doc.numero });
          continue;
        }

        if (!dryRun) {
          const { error: upErr } = await supabase
            .from("fiscal_documents")
            .update(updates)
            .eq("id", doc.id);
          if (upErr) throw upErr;
        }

        if (updates.xml_content) result.recovered_xml++;
        if (updates.danfe_url) result.recovered_danfe++;
      } catch (e: any) {
        result.failed.push({ id: doc.id, error: e?.message || String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[fiscal-backfill-xml]", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
