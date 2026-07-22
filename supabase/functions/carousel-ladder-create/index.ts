import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Etapa 1 — cria UM degrau da "escada" de templates de carrossel (qtd_cards 2..10).
// Faz tudo server-side:
//   1. Resolve credenciais Meta do número WABA.
//   2. Faz upload de 1 imagem-exemplo (Resumable Upload API) -> header_handle.
//   3. Monta os componentes do carrossel com N cards (header IMAGE + body {{1}} + botão).
//   4. Submete o template à Meta.
//   5. Faz upsert em templates_carrossel (status PENDING até aprovação).
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const {
      whatsappNumberId,
      qtdCards,
      sampleImageBase64,
      sampleImageType,
      templateName,
      language,
      topBody,
      cardBody,
      cards: cardsInput,
      modelo,
      scope: scopeInput,
      eventId,
    } = body as Record<string, unknown>;

    const scope = scopeInput === "event" ? "event" : "pos";
    const eventIdVal = typeof eventId === "string" && eventId ? eventId : null;

    const modelName = (typeof modelo === "string" && modelo.trim()) ? modelo.trim() : "Padrão";
    const modelSlug = modelName
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
      .slice(0, 40) || "padrao";

    const cards = Number(qtdCards);
    if (!Number.isInteger(cards) || cards < 2 || cards > 10) {
      return json({ error: 'qtdCards deve ser um inteiro entre 2 e 10' }, 400);
    }
    if (!sampleImageBase64 || !sampleImageType) {
      return json({ error: 'sampleImageBase64 e sampleImageType são obrigatórios' }, 400);
    }

    // topBody / cardBody come pre-converted to Meta positional vars from the client:
    //   { text: "Oiee {{1}}", examples: ["Maria"] }
    type TextComp = { text: string; examples?: string[] };
    type Btn = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; urlExample?: string; phone?: string };
    const top = (topBody as TextComp) || { text: '{{1}}', examples: ['Confira nossas novidades 👟'] };
    const legend = (cardBody as TextComp) || { text: '{{1}}', examples: ['Produto incrível por um super preço'] };
    const cardDefs = Array.isArray(cardsInput) ? (cardsInput as Array<{ buttons: Btn[] }>) : [];

    if (!top.text?.trim()) return json({ error: 'topBody.text é obrigatório' }, 400);
    if (!legend.text?.trim()) return json({ error: 'cardBody.text é obrigatório' }, 400);
    if (cardDefs.length !== cards) {
      return json({ error: `cards deve ter exatamente ${cards} itens` }, 400);
    }

    // 1) Credenciais Meta — número específico (precisa ser WABA oficial), fallback default.
    let accessToken = '';
    let businessAccountId = '';
    if (whatsappNumberId) {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('access_token, business_account_id')
        .eq('id', whatsappNumberId)
        .eq('is_active', true)
        .maybeSingle();
      if (data) { accessToken = data.access_token; businessAccountId = data.business_account_id; }
    }
    if (!accessToken || !businessAccountId) {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('access_token, business_account_id')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      if (data) { accessToken = data.access_token; businessAccountId = data.business_account_id; }
    }
    if (!accessToken || !businessAccountId) {
      return json({ error: 'Número Meta/WABA não configurado (access_token + business_account_id).' }, 400);
    }

    // 2) Upload da imagem-exemplo -> header_handle.
    const handle = await uploadSampleImage(accessToken, String(sampleImageBase64), String(sampleImageType));
    if (!handle.ok) return json({ error: handle.error, details: handle.details }, 500);

    // 3) Monta os componentes do carrossel.
    const lang = (language as string) || 'pt_BR';
    const prefix = scope === "event" ? "evento_" : "";
    const name = (templateName as string) ||
      (modelSlug === "padrao"
        ? `${prefix}carrossel_escada_${cards}cards`
        : `${prefix}carrossel_${modelSlug}_${cards}cards`);

    const textComponent = (comp: TextComp) => {
      const c: Record<string, unknown> = { type: 'BODY', text: comp.text };
      if (comp.examples && comp.examples.length) c.example = { body_text: [comp.examples] };
      return c;
    };

    const toMetaButton = (b: Btn) => {
      if (b.type === 'URL') {
        const out: Record<string, unknown> = { type: 'URL', text: b.text, url: b.url };
        if (b.urlExample) out.example = [b.urlExample];
        return out;
      }
      if (b.type === 'PHONE_NUMBER') {
        return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone };
      }
      return { type: 'QUICK_REPLY', text: b.text };
    };

    const carouselCards = cardDefs.map((cd) => {
      const comps: Record<string, unknown>[] = [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle.handle] } },
        textComponent(legend),
      ];
      const btns = (cd.buttons || []).filter((b) => b.text?.trim());
      if (btns.length) comps.push({ type: 'BUTTONS', buttons: btns.map(toMetaButton) });
      return { components: comps };
    });

    const components = [
      textComponent(top),
      { type: 'CAROUSEL', cards: carouselCards },
    ];


    // 4) Submete à Meta.
    const graphUrl = `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates`;
    const metaRes = await fetch(graphUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category: 'MARKETING', language: lang, components }),
    });
    const metaData = await metaRes.json();
    if (!metaRes.ok) {
      console.error('Meta create carousel template error:', metaData);
      return json({ error: 'Falha ao criar template na Meta', details: metaData }, metaRes.status || 500);
    }

    const metaStatus = (metaData?.status as string) || 'PENDING';

    // 5) Upsert na escada.
    const { error: upErr } = await supabase
      .from('templates_carrossel')
      .upsert({
        qtd_cards: cards,
        nome: modelName,
        template_id: name,
        template_language: lang,
        aprovado: metaStatus === 'APPROVED',
        meta_status: metaStatus,
        whatsapp_number_id: (whatsappNumberId as string) || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'whatsapp_number_id,nome,qtd_cards' });
    if (upErr) {
      console.error('Upsert templates_carrossel error:', upErr);
      return json({ error: 'Template criado na Meta, mas falhou ao salvar na escada', details: upErr.message }, 500);
    }

    return json({ success: true, template_id: name, meta_status: metaStatus, meta: metaData }, 200);
  } catch (error) {
    console.error('carousel-ladder-create error:', error);
    return json({ error: 'Internal server error', details: (error as Error).message }, 500);
  }

  function json(payload: unknown, status: number) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function uploadSampleImage(accessToken: string, fileBase64: string, fileType: string) {
  try {
    const cleanB64 = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
    const binary = Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0));
    const fileLength = binary.byteLength;

    let appId = Deno.env.get('META_APP_ID') || '';
    if (!appId) {
      const dbgRes = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(accessToken)}`,
      );
      const dbg = await dbgRes.json();
      appId = dbg?.data?.app_id || '';
      if (!appId) return { ok: false as const, error: 'Não foi possível resolver o App ID da Meta.', details: dbg };
    }

    const sessionUrl = `https://graph.facebook.com/v21.0/${appId}/uploads?file_name=sample.jpg&file_length=${fileLength}&file_type=${encodeURIComponent(fileType)}&access_token=${encodeURIComponent(accessToken)}`;
    const sessionRes = await fetch(sessionUrl, { method: 'POST' });
    const sessionData = await sessionRes.json();
    if (!sessionRes.ok || !sessionData?.id) {
      return { ok: false as const, error: 'Falha ao criar sessão de upload na Meta', details: sessionData };
    }

    const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${sessionData.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${accessToken}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
      body: binary,
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData?.h) {
      return { ok: false as const, error: 'Falha ao enviar a imagem-exemplo para a Meta', details: uploadData };
    }
    return { ok: true as const, handle: uploadData.h as string };
  } catch (e) {
    return { ok: false as const, error: 'Erro no upload da imagem-exemplo', details: (e as Error).message };
  }
}
