// Edge function: nfe-manifestar
// Envia manifestação do destinatário para uma NF-e recebida.
// Tipos: ciencia | confirmacao | desconhecimento | nao_realizada
// Body: { nfe_received_id: uuid, tipo: string, justificativa?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRASILNFE_BASE = "https://api.brasilnfe.com.br/services";

const TIPO_EVENTO_MAP: Record<string, { code: string; label: string; precisaJust: boolean }> = {
  ciencia:         { code: "210210", label: "Ciência da Operação",         precisaJust: false },
  confirmacao:     { code: "210200", label: "Confirmação da Operação",     precisaJust: false },
  desconhecimento: { code: "210220", label: "Desconhecimento da Operação", precisaJust: false },
  nao_realizada:   { code: "210240", label: "Operação não Realizada",      precisaJust: true  },
};

const digits = (s: any) => String(s ?? "").replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { nfe_received_id, tipo, justificativa } = await req.json();
    if (!nfe_received_id || !tipo) throw new Error("nfe_received_id e tipo são obrigatórios");
    const evt = TIPO_EVENTO_MAP[tipo];
    if (!evt) throw new Error(`tipo inválido: ${tipo}`);
    if (evt.precisaJust && (!justificativa || justificativa.trim().length < 15)) {
      throw new Error("Justificativa obrigatória (mín. 15 caracteres) para Operação não Realizada");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // auth user (para registrar quem manifestou)
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = user?.id ?? null;
    }

    const { data: nfe, error: nfeErr } = await supabase
      .from("nfe_received")
      .select("*, companies(*)")
      .eq("id", nfe_received_id)
      .single();
    if (nfeErr || !nfe) throw new Error("NF-e não encontrada");

    const company = (nfe as any).companies;
    if (!company?.brasilnfe_token) throw new Error("Empresa sem token BrasilNFe");

    const reqPayload = {
      ChaveAcesso: nfe.chave_acesso,
      CNPJDestinatario: digits(company.cnpj),
      TipoEvento: evt.code,
      Justificativa: justificativa || evt.label,
      TipoAmbiente: company.ambiente_nfe === "producao" ? "1" : "2",
    };

    const resp = await fetch(`${BRASILNFE_BASE}/Fiscal/ManifestarNotaFiscal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${company.brasilnfe_token}` },
      body: JSON.stringify(reqPayload),
      signal: AbortSignal.timeout(30000),
    });

    const text = await resp.text();
    let respBody: any;
    try { respBody = JSON.parse(text); } catch { respBody = { raw: text }; }

    const ok = resp.ok && (respBody?.Status === "135" || respBody?.Status === "136" || respBody?.cStat === 135 || respBody?.cStat === 136 || respBody?.Sucesso === true);
    const protocolo = respBody?.NumeroProtocolo || respBody?.nProt || respBody?.Protocolo || null;

    await supabase.from("nfe_received_events").insert({
      nfe_received_id,
      event_type: tipo,
      status: ok ? "ok" : "erro",
      protocolo,
      justificativa: justificativa || null,
      request_payload: reqPayload,
      response_payload: respBody,
      performed_by: userId,
    });

    if (ok) {
      await supabase.from("nfe_received").update({
        manifestacao_status: tipo,
        manifestacao_data: new Date().toISOString(),
        manifestacao_protocolo: protocolo,
        manifestacao_justificativa: justificativa || null,
      }).eq("id", nfe_received_id);
    }

    return new Response(JSON.stringify({ ok, protocolo, response: respBody }), {
      status: ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
