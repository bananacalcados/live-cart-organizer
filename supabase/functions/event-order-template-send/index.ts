// Envio MANUAL do template Meta configurado no evento (etapa MENSAGEM do wizard)
// para o WhatsApp da cliente de um pedido específico.
// Não altera etapa do pedido, não cria sessão de IA — apenas dispara o template.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { issueMagicLink } from "../_shared/member-magic-link.ts";
import { fetchTemplateDef, renderTemplateMessage } from "../_shared/meta-template-render.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // `viaNumberId`: quando informado, o MESMO conteúdo do template é enviado
    // como mensagem comum por uma instância NÃO-API (uazapi/wasender/zapi).
    // Serve para validar se o número que a cliente passou na live existe de fato
    // (a Cloud API devolve 131026 "Message undeliverable" nesses casos).
    // Modo CONTATO (sem pedido): eventId + phone (+ name) — linha "Novos contatos".
    const { orderId, viaNumberId, eventId: contactEventId, phone: contactPhone, name: contactName } = await req.json();
    if (!orderId && !(contactEventId && contactPhone)) {
      return json({ error: 'orderId ou (eventId + phone) required' }, 400);
    }

    let order: any;
    let customer: any;
    if (orderId) {
      const { data } = await supabase
        .from('orders')
        .select('id, event_id, customer_id, products, cart_link, discount_type, discount_value')
        .eq('id', orderId)
        .maybeSingle();
      if (!data) return json({ error: 'Pedido não encontrado' }, 404);
      if (!data.event_id) return json({ error: 'Pedido sem evento vinculado' }, 400);
      order = data;
      const { data: c } = await supabase
        .from('customers')
        .select('id, instagram_handle, whatsapp')
        .eq('id', order.customer_id)
        .maybeSingle();
      customer = c;
    } else {
      order = { id: null, event_id: contactEventId, products: [], cart_link: null, discount_type: null, discount_value: null };
      customer = { instagram_handle: contactName || null, whatsapp: contactPhone };
    }

    const rawPhone = (customer?.whatsapp || '').replace(/\D/g, '');
    if (!rawPhone) return json({ error: 'Cliente sem WhatsApp cadastrado' }, 400);
    const waPhone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone;

    const { data: eventData } = await supabase
      .from('events')
      .select('whatsapp_number_id, meta_template_name, meta_template_language, meta_template_body_variables, meta_template_header_variable')
      .eq('id', order.event_id)
      .maybeSingle();

    const templateName = (eventData as any)?.meta_template_name || null;
    const whatsappNumberId = (eventData as any)?.whatsapp_number_id || null;
    if (!templateName) {
      return json({ error: 'Nenhum template configurado na etapa MENSAGEM do evento.' }, 400);
    }
    if (!whatsappNumberId) {
      return json({ error: 'Nenhuma instância WhatsApp configurada no evento.' }, 400);
    }

    // ---- Tokens (mesma resolução usada no disparo automático) ----
    const products = (order.products as any[]) || [];
    const productLines = products
      .map((p: any) => `${p.quantity || 1}x ${p.title}${p.variant ? ` (${p.variant})` : ''} — R$${Number(p.price || 0).toFixed(2)}`)
      .join('\n');
    const subtotal = products.reduce(
      (sum: number, p: any) => sum + Number(p.price || 0) * Number(p.quantity || 1),
      0,
    );
    let discountAmount = 0;
    if (order.discount_value && Number(order.discount_value) > 0) {
      discountAmount = order.discount_type === 'percentage'
        ? subtotal * (Number(order.discount_value) / 100)
        : Number(order.discount_value);
    }
    const total = Math.max(0, subtotal - discountAmount);

    const igHandle = customer?.instagram_handle || 'Cliente';
    const igName = igHandle.startsWith('@') ? igHandle : `@${igHandle}`;
    const firstName = (igHandle.replace(/^@/, '').split(/[._\s]/)[0] || '').trim();
    const displayName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : igName;
    const checkoutLink = order.cart_link || (orderId ? `https://checkout.bananacalcados.com.br/checkout/order/${orderId}` : 'https://checkout.bananacalcados.com.br/minha-area');

    const bodyVarsRaw = ((eventData as any)?.meta_template_body_variables as string[]) || [];
    const headerVarRaw = (eventData as any)?.meta_template_header_variable || null;
    const usesMemberLink = [...bodyVarsRaw, headerVarRaw || ''].some((v) =>
      String(v || '').includes('{member_area_link}'),
    );
    const memberAreaLink = usesMemberLink
      ? await issueMagicLink(supabase, waPhone)
      : 'https://checkout.bananacalcados.com.br/minha-area';

    const resolveToken = (token: string): string => {
      switch (token) {
        case '{customer_name}': return igHandle || displayName || '';
        case '{customer_first_name}': return displayName || '';
        case '{instagram}': return igName || '';
        case '{products}': return productLines || '';
        case '{products_short}': return products.map((p: any) => `${p.quantity || 1}x ${p.title}`).join(', ');
        case '{checkout_link}': return checkoutLink || '';
        case '{member_area_link}': return memberAreaLink;
        case '{subtotal}': return `R$${subtotal.toFixed(2)}`;
        case '{discount}': return `R$${discountAmount.toFixed(2)}`;
        case '{total}': return `R$${total.toFixed(2)}`;
        case '{order_id}': return orderId ? String(orderId).slice(0, 8) : '';
        default: return token || '';
      }
    };

    const bodyVars = ((eventData as any)?.meta_template_body_variables as string[]) || [];
    const headerVar = (eventData as any)?.meta_template_header_variable || null;

    // ─────────── Envio por instância NÃO-API (uazapi / wasender / zapi) ───────────
    if (viaNumberId) {
      const { data: viaNum } = await supabase
        .from('whatsapp_numbers')
        .select('id, provider, is_active, label')
        .eq('id', viaNumberId)
        .maybeSingle();
      if (!viaNum || !viaNum.is_active) {
        return json({ error: 'Instância selecionada não encontrada ou inativa.' }, 400);
      }
      const provider = String(viaNum.provider || '');
      if (!['uazapi', 'wasender', 'zapi'].includes(provider)) {
        return json({ error: 'Selecione uma instância não-API (uazapi/wasender/zapi).' }, 400);
      }

      // Renderiza o corpo completo do template Meta (mesmo texto do disparo oficial)
      const { data: metaNum } = await supabase
        .from('whatsapp_numbers')
        .select('access_token, business_account_id')
        .eq('id', whatsappNumberId)
        .maybeSingle();

      const components: any[] = [];
      const def = await fetchTemplateDef(
        (metaNum as any)?.access_token || '',
        (metaNum as any)?.business_account_id || '',
        templateName,
        (eventData as any)?.meta_template_language || 'pt_BR',
      ).catch(() => null);

      const headerDef = (def?.components || []).find(
        (c: any) => (c.type || '').toUpperCase() === 'HEADER',
      );
      const headerFormat = String(headerDef?.format || 'TEXT').toUpperCase();
      if (headerVar && headerFormat === 'TEXT') {
        components.push({ type: 'header', parameters: [{ type: 'text', text: resolveToken(headerVar) }] });
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
        const link = (headerVar ? resolveToken(headerVar) : '') || headerDef?.example?.header_handle?.[0] || null;
        if (link) {
          const key = headerFormat.toLowerCase();
          components.push({ type: 'header', parameters: [{ type: key, [key]: { link } }] });
        }
      }
      if (bodyVars.length > 0) {
        components.push({
          type: 'body',
          parameters: bodyVars.map((t) => ({ type: 'text', text: resolveToken(t) })),
        });
      }

      let text = '';
      let mediaUrl: string | null = null;
      let mediaType = 'text';
      if (def) {
        const r = renderTemplateMessage(def, components);
        text = r.text;
        mediaUrl = r.mediaUrl;
        mediaType = r.mediaType;
      }
      if (!text) {
        // Fallback: sem acesso à definição do template, envia o resumo do pedido.
        text = `Oi ${displayName}! Aqui está seu pedido:\n\n${productLines}\n\nTotal: R$${total.toFixed(2)}\n\n${checkoutLink}`;
      }

      const fnBase = provider === 'uazapi' ? 'uazapi' : provider === 'wasender' ? 'wasender' : 'zapi';
      const headers = {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'x-force-instance': 'true',
      };

      let sendResp: Response;
      if (mediaUrl && mediaType !== 'text') {
        sendResp = await fetch(`${supabaseUrl}/functions/v1/${fnBase}-send-media`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            phone: waPhone,
            mediaUrl,
            mediaType,
            caption: text,
            whatsapp_number_id: viaNumberId,
          }),
        });
      } else {
        sendResp = await fetch(`${supabaseUrl}/functions/v1/${fnBase}-send-message`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ phone: waPhone, message: text, whatsapp_number_id: viaNumberId }),
        });
      }

      const sendResult = await sendResp.json().catch(() => ({}));
      if (!sendResp.ok || (sendResult as any)?.error) {
        console.error('[event-order-template-send] via instância falhou:', sendResp.status, sendResult);
        return json(
          {
            error: (sendResult as any)?.message || (sendResult as any)?.error || 'Falha ao enviar pela instância',
            details: sendResult,
          },
          502,
        );
      }

      // Registra a mensagem para o chat mostrar o conteúdo e a conversa passar a
      // ficar vinculada a esta instância.
      await supabase.from('whatsapp_messages').insert({
        phone: waPhone,
        message: text.slice(0, 4000),
        direction: 'outgoing',
        status: 'sent',
        media_url: mediaUrl,
        media_type: mediaType,
        whatsapp_number_id: viaNumberId,
        message_id: (sendResult as any)?.messageId || null,
      });

      if (orderId) {
        await supabase.from('orders').update({ last_sent_message_at: new Date().toISOString() }).eq('id', orderId);
      }

      return json({ success: true, via: viaNum.label || provider, phone: waPhone });
    }


    const resp = await fetch(`${supabaseUrl}/functions/v1/meta-template-send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: waPhone,
        whatsappNumberId,
        templateName,
        language: (eventData as any)?.meta_template_language || 'pt_BR',
        bodyParameters: bodyVars.map((t) => resolveToken(t)),
        headerParameter: headerVar ? resolveToken(headerVar) : undefined,
      }),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('[event-order-template-send] failed:', resp.status, result);
      return json({ error: (result as any)?.error || 'Falha ao enviar template', details: result }, 502);
    }

    if (orderId) {
      await supabase.from('orders').update({ last_sent_message_at: new Date().toISOString() }).eq('id', orderId);
    }

    return json({ success: true, templateName, phone: waPhone });
  } catch (e) {
    console.error('[event-order-template-send] error:', e);
    return json({ error: String(e) }, 500);
  }
});
