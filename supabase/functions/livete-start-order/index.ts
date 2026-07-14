import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId, fallbackCommentId: requestFallbackCommentId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'orderId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, event_id, customer_id, products, stage, stage_atendimento, shipping_cost, free_shipping, delivery_method, cart_link, discount_type, discount_value')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      console.error('[livete-start] Order not found:', orderId, orderErr);
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, instagram_handle, whatsapp')
      .eq('id', order.customer_id)
      .single();

    // Resolve event channel preference + whatsapp number + meta template config + initial message override
    let channelPreference: string = 'whatsapp';
    let channelPreferences: string[] = [];
    let whatsappNumberId: string | null = null;
    let metaPhoneNumberId: string | null = null;
    let metaTemplateName: string | null = null;
    let metaTemplateLanguage: string = 'pt_BR';
    let metaTemplateBodyVars: string[] = [];
    let metaTemplateHeaderVar: string | null = null;
    let initialMessageEnabled = false;
    let initialMessageBlocks: string[] = [];
    let igInitialButtons: Array<{ blockIndex: number; buttons: Array<{ id: string; type: 'url' | 'automation'; title: string; urlToken?: string; automationId?: string }> }> = [];
    let igAutomationsList: Array<{ id: string; label?: string }> = [];

    if (order.event_id) {
      const { data: eventData } = await supabase
        .from('events')
        .select('whatsapp_number_id, channel_preference, channel_preferences, meta_template_name, meta_template_language, meta_template_body_variables, meta_template_header_variable, initial_message_enabled, initial_message_blocks')
        .eq('id', order.event_id)
        .single();

      if (eventData?.channel_preference) channelPreference = eventData.channel_preference;
      channelPreferences = ((eventData as any)?.channel_preferences as string[]) || [];
      if (!channelPreferences.length) channelPreferences = [channelPreference];
      metaTemplateName = (eventData as any)?.meta_template_name || null;
      metaTemplateLanguage = (eventData as any)?.meta_template_language || 'pt_BR';
      metaTemplateBodyVars = ((eventData as any)?.meta_template_body_variables as string[]) || [];
      metaTemplateHeaderVar = (eventData as any)?.meta_template_header_variable || null;
      initialMessageEnabled = Boolean((eventData as any)?.initial_message_enabled);
      initialMessageBlocks = (((eventData as any)?.initial_message_blocks as string[]) || []).filter((b) => typeof b === 'string' && b.trim().length > 0);

      if (eventData?.whatsapp_number_id) {
        whatsappNumberId = eventData.whatsapp_number_id;
        const { data: wnData } = await supabase
          .from('whatsapp_numbers')
          .select('id, label, provider, phone_number_id')
          .eq('id', whatsappNumberId)
          .single();
        if (wnData?.provider === 'meta' && wnData?.phone_number_id) {
          metaPhoneNumberId = wnData.phone_number_id;
        }
      }
    }

    const wantsInstagram = channelPreferences.includes('instagram');
    const wantsZapi = channelPreferences.includes('whatsapp');
    const wantsMeta = channelPreferences.includes('meta_whatsapp');
    // For legacy logic compatibility: "isInstagram" means IG is the only channel
    const isInstagram = wantsInstagram && !wantsZapi && !wantsMeta;

    if (isInstagram) {
      // Aceita IG sem handle se tiver WhatsApp como fallback
      if (!customer?.instagram_handle && !customer?.whatsapp) {
        console.error('[livete-start] Customer has no instagram_handle nor whatsapp:', order.customer_id);
        return new Response(JSON.stringify({ error: 'Customer has no contact channel' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else if (!customer?.whatsapp && !(wantsInstagram && customer?.instagram_handle)) {
      console.error('[livete-start] Customer has no WhatsApp:', order.customer_id);
      return new Response(JSON.stringify({ error: 'Customer has no WhatsApp' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const igUsername = (customer?.instagram_handle || '').replace(/^@/, '').trim().toLowerCase();
    const rawPhone = (customer?.whatsapp || '').replace(/\D/g, '');
    const phone = isInstagram
      ? igUsername
      : (rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone);

    let savedAddress: Record<string, string> | null = null;
    if (customer.id) {
      const { data: addrData } = await supabase.rpc('get_customer_last_address', {
        p_customer_id: customer.id,
      });
      if (addrData && typeof addrData === 'object' && (addrData as any).cep) {
        savedAddress = addrData as Record<string, string>;
      }
    }

    const products = (order.products as any[]) || [];
    const productLines = products.map((p: any) =>
      `${p.quantity || 1}x ${p.title}${p.variant ? ` (${p.variant})` : ''} — R$${Number(p.price || 0).toFixed(2)}`
    ).join('\n');

    const subtotal = products.reduce((sum: number, p: any) =>
      sum + (Number(p.price || 0) * Number(p.quantity || 1)), 0
    );

    let discountAmount = 0;
    if (order.discount_value && Number(order.discount_value) > 0) {
      if (order.discount_type === 'fixed') {
        discountAmount = Number(order.discount_value);
      } else if (order.discount_type === 'percentage') {
        discountAmount = subtotal * (Number(order.discount_value) / 100);
      }
    }
    const total = Math.max(0, subtotal - discountAmount);

    let pricingBlock = `💰 Subtotal: R$${subtotal.toFixed(2)}`;
    if (discountAmount > 0) {
      pricingBlock += `\n🏷️ Desconto: -R$${discountAmount.toFixed(2)}`;
      pricingBlock += `\n✅ *Total: R$${total.toFixed(2)}*`;
    }

    const igHandle = customer.instagram_handle || 'Cliente';
    const igName = igHandle.startsWith('@') ? igHandle : `@${igHandle}`;

    const checkoutLink = order.cart_link || `https://checkout.bananacalcados.com.br/checkout/order/${orderId}`;

    const firstName = (igHandle.replace(/^@/, '').split(/[._\s]/)[0] || '').trim();
    const displayName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : igName;

    const defaultBlocks = [
      `Oii ${displayName}, já separamos seu pedido.`,
      checkoutLink,
      `Só clicar no link acima pra finalizar a compra. Seu produto já foi separado, mas precisa ser pago em 10 minutos, pra continuar reservado, OK?`,
    ];

    const useCustomInitialMessage = initialMessageEnabled && initialMessageBlocks.length > 0;

    const initialStage = savedAddress ? 'aguardando_pagamento' : 'endereco';

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const sessionPayload = {
      phone,
      flow_id: null,
      is_active: true,
      prompt: `livete_checkout:${orderId}`,
      expires_at: expiresAt,
      whatsapp_number_id: whatsappNumberId,
      max_messages: 50,
      messages_sent: 1,
      updated_at: new Date().toISOString(),
    };

    const { error: sessionErr } = await supabase
      .from('automation_ai_sessions')
      .upsert(sessionPayload, { onConflict: 'phone' });

    if (sessionErr) {
      console.error('[livete-start] Failed to upsert AI session:', sessionErr);
      return new Response(JSON.stringify({ error: 'Failed to create AI session' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.rpc('update_order_stage', {
      p_order_id: orderId,
      p_stage: initialStage,
    });
    await supabase.from('orders').update({ stage: 'contacted' }).eq('id', orderId);

    // ===== Branch: Meta WhatsApp Template (overrides 3-block send for WA) =====
    // If the event's WhatsApp number is a Meta API instance AND a template is
    // configured, always send via template — even when channel_preference wasn't
    // explicitly set to "meta_whatsapp" (wizard saves the template without
    // changing channel_preference). Outside the 24h window a plain session
    // message would silently fail, so the template is the correct path here.
    const useMetaTemplate =
      (wantsMeta || !wantsInstagram) &&
      !!metaPhoneNumberId &&
      !!metaTemplateName;


    const resolveToken = (token: string): string => {
      switch (token) {
        case '{customer_name}': return igHandle || displayName || '';
        case '{customer_first_name}': return displayName || '';
        case '{instagram}': return igName || '';
        case '{products}': return productLines || '';
        case '{products_short}':
          return products.map((p: any) => `${p.quantity || 1}x ${p.title}`).join(', ');
        case '{checkout_link}': return checkoutLink || '';
        case '{subtotal}': return `R$${subtotal.toFixed(2)}`;
        case '{discount}': return `R$${discountAmount.toFixed(2)}`;
        case '{total}': return `R$${total.toFixed(2)}`;
        case '{order_id}': return String(orderId).slice(0, 8);
        default: return token || '';
      }
    };

    const recentThreshold = new Date(Date.now() - 15000).toISOString();
    let duplicateQuery = supabase
      .from('whatsapp_messages')
      .select('id, created_at')
      .eq('phone', phone)
      .eq('direction', 'outgoing')
      .gte('created_at', recentThreshold)
      .order('created_at', { ascending: false })
      .limit(1);

    duplicateQuery = whatsappNumberId
      ? duplicateQuery.eq('whatsapp_number_id', whatsappNumberId)
      : duplicateQuery.is('whatsapp_number_id', null);

    const { data: recentDuplicate } = await duplicateQuery;
    const shouldSkipSend = Boolean(recentDuplicate && recentDuplicate.length > 0);

    const waPhone = rawPhone ? (rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone) : '';

    const humanDelay = (text: string) => {
      const base = Math.max(1500, text.length * 45);
      const jitter = Math.floor(Math.random() * 800) - 400;
      return Math.max(1200, base + jitter);
    };

    const renderBlock = (raw: string) =>
      raw.replace(/\{[a-z_]+\}/gi, (match) => resolveToken(match));

    const sourceBlocks = useCustomInitialMessage ? initialMessageBlocks : defaultBlocks;
    const rendered = sourceBlocks.map(renderBlock).filter((t) => t.trim().length > 0);

    // ---- Instagram dispatch (parallel to WA when both selected) ----
    const dispatchInstagram = async () => {
      if (!wantsInstagram || !igUsername) return;
      // Reúne vários comment_ids recentes do cliente (mais novos primeiro).
      // Um comentário de Live só aceita UM private_reply e pode ficar inelegível,
      // então passamos uma lista para o instagram-dm-send tentar em sequência.
      const commentIds: string[] = [];
      if (requestFallbackCommentId) commentIds.push(requestFallbackCommentId);
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: eventComments } = await supabase
          .from('live_comments')
          .select('comment_id')
          .eq('event_id', order.event_id)
          .ilike('username', igUsername)
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false })
          .limit(5);
        for (const c of (eventComments || [])) {
          if (c?.comment_id) commentIds.push(c.comment_id);
        }
        if (commentIds.length === 0) {
          const { data: anyComments } = await supabase
            .from('live_comments')
            .select('comment_id')
            .ilike('username', igUsername)
            .gte('created_at', sevenDaysAgo)
            .order('created_at', { ascending: false })
            .limit(5);
          for (const c of (anyComments || [])) {
            if (c?.comment_id) commentIds.push(c.comment_id);
          }
        }
      } catch (e) {
        console.warn('[livete-start] failed to gather comment_ids:', e);
      }
      const fallbackCommentIds = Array.from(new Set(commentIds));
      const fallbackCommentId = fallbackCommentIds[0];

      let igFailed = false;
      for (let i = 0; i < rendered.length; i++) {
        const text = rendered[i];
        if (!igFailed) {
          const igResp = await fetch(`${supabaseUrl}/functions/v1/instagram-dm-send`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: igUsername,
              message: text,
              eventId: order.event_id,
              fallbackCommentId,
              fallbackCommentIds,
            }),
          });
          if (!igResp.ok) {
            const errBody = await igResp.text().catch(() => '');
            console.warn(`[livete-start] IG send failed (${igResp.status}) for @${igUsername}:`, errBody);
            igFailed = true;
            // Fallback to WA only when IG was the ONLY selected channel
            if (isInstagram && waPhone) {
              await sendViaWhatsApp(text);
            }
          }
        } else if (isInstagram && waPhone) {
          await sendViaWhatsApp(text);
        }
        if (i < rendered.length - 1) {
          await new Promise((r) => setTimeout(r, humanDelay(rendered[i + 1])));
        }
      }
    };

    // ---- WhatsApp helpers ----
    const sendViaWhatsApp = async (text: string) => {
      if (!waPhone) return;
      if (metaPhoneNumberId) {
        await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: waPhone, message: text, whatsappNumberId }),
        });
      } else {
        await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: waPhone, message: text, whatsapp_number_id: whatsappNumberId }),
        });
      }
      await supabase.from('whatsapp_messages').insert({
        phone: waPhone, message: text, direction: 'outgoing', status: 'sent', whatsapp_number_id: whatsappNumberId,
      });
    };

    const dispatchMetaTemplate = async () => {
      if (!useMetaTemplate || !waPhone) return;
      const bodyParameters = metaTemplateBodyVars.map((t) => resolveToken(t));
      const headerParameter = metaTemplateHeaderVar ? resolveToken(metaTemplateHeaderVar) : undefined;
      console.log(`[livete-start] Sending Meta template ${metaTemplateName} to ${waPhone}`, { bodyParameters, headerParameter });
      const tplResp = await fetch(`${supabaseUrl}/functions/v1/meta-template-send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: waPhone,
          whatsappNumberId,
          templateName: metaTemplateName,
          language: metaTemplateLanguage,
          bodyParameters,
          headerParameter,
        }),
      });
      if (!tplResp.ok) {
        const errBody = await tplResp.text();
        console.error('[livete-start] meta-template-send failed:', tplResp.status, errBody);
      }
    };

    const dispatchZapiBlocks = async () => {
      if (!wantsZapi || !waPhone) return;
      console.log(`[livete-start] Sending ${rendered.length} Z-API blocks to ${waPhone} (custom=${useCustomInitialMessage})`);
      for (let i = 0; i < rendered.length; i++) {
        await sendViaWhatsApp(rendered[i]);
        if (i < rendered.length - 1) {
          await new Promise((r) => setTimeout(r, humanDelay(rendered[i + 1])));
        }
      }
    };

    if (shouldSkipSend) {
      console.log(`[livete-start] Duplicate start skipped for order ${orderId} / ${phone}`);
    } else {
      // Run all selected channels in parallel
      await Promise.allSettled([
        dispatchInstagram(),
        useMetaTemplate ? dispatchMetaTemplate() : dispatchZapiBlocks(),
      ]);
    }


    const responseTime = Date.now() - startTime;
    await supabase.from('ai_conversation_logs').insert({
      order_id: orderId,
      phone,
      stage: initialStage,
      message_out: shouldSkipSend ? null : (useCustomInitialMessage ? initialMessageBlocks.join('\n\n') : defaultBlocks.join('\n\n')),
      ai_decision: shouldSkipSend ? 'start_skipped_duplicate' : (savedAddress ? 'confirm_existing_address' : 'ask_new_address'),
      tool_called: 'livete-start-order',
      response_time_ms: responseTime,
      provider: 'system',
    });

    console.log(`[livete-start] Order ${orderId} → phone=${phone}, stage=${initialStage}, hasAddress=${!!savedAddress}, duplicateSkipped=${shouldSkipSend}, time=${responseTime}ms`);

    return new Response(JSON.stringify({
      success: true,
      phone,
      stage: initialStage,
      hasAddress: !!savedAddress,
      duplicateSkipped: shouldSkipSend,
      responseTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[livete-start] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});