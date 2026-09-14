import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Acesso ao PDF de boletos já gerados.
//  - action "list": últimos boletos de um telefone (para reabrir/baixar).
//  - action "url" : garante um link PÚBLICO e estável do PDF (espelho no bucket
//    whatsapp-media), usado tanto para baixar quanto para enviar no WhatsApp
//    (a uazapi/zapi precisa baixar o arquivo por URL pública — URL assinada do
//    bucket privado nem sempre é aceita pelos provedores).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Exige usuário autenticado (staff) — dados de cliente.
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "Não autenticado" }, 401);
    const { data: userRes } = await supabase.auth.getUser(auth.slice(7));
    if (!userRes?.user) return json({ ok: false, error: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action || "url";

    if (action === "list") {
      const phone = digits(body?.phone);
      if (phone.length < 8) return json({ ok: false, error: "Telefone inválido" }, 400);
      const suffix = phone.slice(-8);
      const { data, error } = await supabase
        .from("pos_boletos")
        .select("id, created_at, amount, due_date, status, description, customer_name, customer_phone, mp_boleto_url, pdf_path")
        .like("customer_phone", `%${suffix}`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return json({ ok: true, boletos: data || [] });
    }

    const boletoId = String(body?.boletoId || "");
    if (!boletoId) return json({ ok: false, error: "boletoId obrigatório" }, 400);

    const { data: boleto, error: bErr } = await supabase
      .from("pos_boletos")
      .select("id, pdf_path, mp_boleto_url, amount, due_date, status")
      .eq("id", boletoId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!boleto) return json({ ok: false, error: "Boleto não encontrado" }, 404);

    const publicPath = `boletos/${boletoId}.pdf`;
    const publicUrl = supabase.storage.from("whatsapp-media").getPublicUrl(publicPath).data.publicUrl;

    // Já existe espelho público?
    const head = await fetch(publicUrl, { method: "HEAD" });
    if (!head.ok) {
      if (!boleto.pdf_path) return json({ ok: false, error: "PDF deste boleto não está disponível" }, 404);
      const { data: file, error: dErr } = await supabase.storage.from("boletos").download(boleto.pdf_path);
      if (dErr || !file) return json({ ok: false, error: "Não foi possível ler o PDF do boleto" }, 404);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error: upErr } = await supabase.storage
        .from("whatsapp-media")
        .upload(publicPath, bytes, { contentType: "application/pdf", upsert: true });
      if (upErr) return json({ ok: false, error: `Falha ao publicar PDF: ${upErr.message}` }, 500);
    }

    return json({
      ok: true,
      publicUrl,
      boletoUrl: boleto.mp_boleto_url,
      amount: Number(boleto.amount),
      dueDate: boleto.due_date,
      status: boleto.status,
    });
  } catch (err) {
    console.error("[pos-boleto-pdf]", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
