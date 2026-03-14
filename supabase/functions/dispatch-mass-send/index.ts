import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 500;
const CONCURRENCY = 10; // parallel sends at a time

interface VariableConfig {
  mode: string;
  staticValue: string;
}

function resolveVariable(vc: VariableConfig, recipient: any): string {
  switch (vc.mode) {
    case '__first_name__': return recipient.first_name || (recipient.recipient_name || '').split(' ')[0] || 'Cliente';
    case '__full_name__': return recipient.recipient_name || 'Cliente';
    case '__phone__': return recipient.phone || '';
    case '__city__': return recipient.city || 'N/A';
    case '__state__': return recipient.state || 'N/A';
    case '__segment__': return recipient.segment || 'N/A';
    case '__email__': return recipient.email || 'N/A';
    default: return vc.staticValue || 'Cliente';
  }
}

function buildComponentsForRecipient(
  templateComponents: any[],
  variablesConfig: Record<string, VariableConfig>,
  headerMediaUrl: string | null,
  recipient: any | null,
  hasDynamicVars: boolean
) {
  const components: any[] = [];
  
  // Extract template variable info
  const bodyVars: { index: number; key: string }[] = [];
  const headerVars: { index: number; key: string }[] = [];
  const headerComp = templateComponents.find((c: any) => c.type === 'HEADER');
  const buttonsComp = templateComponents.find((c: any) => c.type === 'BUTTONS');
  
  for (const comp of templateComponents) {
    if (comp.text) {
      const matches = [...comp.text.matchAll(/\{\{(\d+)\}\}/g)];
      for (const m of matches) {
        const key = `${comp.type.toLowerCase()}_${m[1]}`;
        if (comp.type === 'BODY') bodyVars.push({ index: parseInt(m[1]), key });
        if (comp.type === 'HEADER') headerVars.push({ index: parseInt(m[1]), key });
      }
    }
  }

  const resolve = (key: string) => {
    const vc = variablesConfig[key];
    if (!vc) return '';
    if (vc.mode === '__static__') return vc.staticValue || 'Cliente';
    if (!recipient || !hasDynamicVars) return vc.staticValue || 'Cliente';
    return resolveVariable(vc, recipient) || 'Cliente';
  };

  // Header media
  if (headerComp && headerComp.format && headerComp.format !== 'TEXT' && headerMediaUrl) {
    const mediaType = headerComp.format.toLowerCase();
    components.push({
      type: 'header',
      parameters: [{ type: mediaType, [mediaType]: { link: headerMediaUrl } }],
    });
  } else if (headerVars.length > 0) {
    components.push({
      type: 'header',
      parameters: headerVars.map(v => ({ type: 'text', text: resolve(v.key) })),
    });
  }

  if (bodyVars.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyVars.map(v => ({ type: 'text', text: resolve(v.key) })),
    });
  }

  // URL buttons
  const urlButtons = (buttonsComp?.buttons || []).filter((b: any) => b.type === 'URL' && b.url?.includes('{{'));
  urlButtons.forEach((btn: any, idx: number) => {
    const suffix = variablesConfig[`button_url_${idx}`]?.staticValue || '';
    if (suffix) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: idx.toString(),
        parameters: [{ type: 'text', text: suffix }],
      });
    }
  });

  return components;
}

function buildRenderedMessage(
  templateComponents: any[],
  variablesConfig: Record<string, VariableConfig>,
  recipient: any | null,
  hasDynamicVars: boolean
): string {
  const parts: string[] = [];
  for (const comp of templateComponents) {
    if (comp.type === 'HEADER' && comp.text) {
      let text = comp.text;
      text = text.replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => {
        const vc = variablesConfig[`header_${n}`];
        if (!vc) return `{{${n}}}`;
        if (vc.mode === '__static__' || !hasDynamicVars || !recipient) return vc.staticValue || '';
        return resolveVariable(vc, recipient);
      });
      parts.push(`*${text}*`);
    }
    if (comp.type === 'BODY' && comp.text) {
      let text = comp.text;
      text = text.replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => {
        const vc = variablesConfig[`body_${n}`];
        if (!vc) return `{{${n}}}`;
        if (vc.mode === '__static__' || !hasDynamicVars || !recipient) return vc.staticValue || '';
        return resolveVariable(vc, recipient);
      });
      parts.push(text);
    }
    if (comp.type === 'FOOTER' && comp.text) {
      parts.push(`_${comp.text}_`);
    }
  }
  return parts.join('\n\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { dispatchId } = await req.json();
    if (!dispatchId) {
      return new Response(JSON.stringify({ error: 'dispatchId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load dispatch record
    const { data: dispatch, error: dispErr } = await supabase
      .from('dispatch_history')
      .select('*')
      .eq('id', dispatchId)
      .single();

    if (dispErr || !dispatch) {
      return new Response(JSON.stringify({ error: 'Dispatch not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if cancelled
    if (dispatch.status === 'cancelled') {
      return new Response(JSON.stringify({ success: true, message: 'Dispatch was cancelled' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check concurrency lock
    if (dispatch.processing_batch) {
      return new Response(JSON.stringify({ success: true, message: 'Another batch is processing' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Acquire lock
    await supabase.from('dispatch_history').update({ processing_batch: true }).eq('id', dispatchId);

    // Get credentials
    let phoneNumberId = '', accessToken = '';
    if (dispatch.whatsapp_number_id) {
      const { data: numData } = await supabase
        .from('whatsapp_numbers')
        .select('phone_number_id, access_token')
        .eq('id', dispatch.whatsapp_number_id)
        .eq('is_active', true)
        .maybeSingle();
      if (numData) {
        phoneNumberId = numData.phone_number_id;
        accessToken = numData.access_token;
      }
    }
    if (!accessToken) {
      const { data: defNum } = await supabase
        .from('whatsapp_numbers')
        .select('phone_number_id, access_token')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      if (defNum) {
        phoneNumberId = defNum.phone_number_id;
        accessToken = defNum.access_token;
      }
    }

    if (!accessToken || !phoneNumberId) {
      await supabase.from('dispatch_history').update({
        processing_batch: false, status: 'failed',
      }).eq('id', dispatchId);
      return new Response(JSON.stringify({ error: 'No WhatsApp credentials' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const graphUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const templateComponents = dispatch.template_components || [];
    const variablesConfig = dispatch.variables_config || {};
    const hasDynamicVars = dispatch.has_dynamic_vars || false;
    const headerMediaUrl = dispatch.header_media_url || null;

    // Fetch pending recipients batch
    const { data: pendingRecipients, error: pendErr } = await supabase
      .from('dispatch_recipients')
      .select('*')
      .eq('dispatch_id', dispatchId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (pendErr) {
      console.error('Error fetching recipients:', pendErr);
      await supabase.from('dispatch_history').update({ processing_batch: false }).eq('id', dispatchId);
      return new Response(JSON.stringify({ error: 'Failed to fetch recipients' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!pendingRecipients || pendingRecipients.length === 0) {
      // All done
      const { count: sentCount } = await supabase
        .from('dispatch_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('dispatch_id', dispatchId)
        .eq('status', 'sent');
      const { count: failedCount } = await supabase
        .from('dispatch_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('dispatch_id', dispatchId)
        .eq('status', 'failed');

      await supabase.from('dispatch_history').update({
        processing_batch: false,
        status: 'completed',
        completed_at: new Date().toISOString(),
        sent_count: sentCount || 0,
        failed_count: failedCount || 0,
      }).eq('id', dispatchId);

      return new Response(JSON.stringify({ success: true, message: 'Dispatch completed', sentCount: sentCount || 0, failedCount: failedCount || 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process batch in parallel chunks
    let batchSent = 0, batchFailed = 0;
    let cancelled = false;

    async function sendOne(recipient: any): Promise<boolean> {
      let formattedPhone = recipient.phone.replace(/\D/g, '');
      if (!formattedPhone.startsWith('55')) formattedPhone = '55' + formattedPhone;

      const components = buildComponentsForRecipient(
        templateComponents, variablesConfig, headerMediaUrl, recipient, hasDynamicVars
      );
      const rendered = buildRenderedMessage(
        templateComponents, variablesConfig, hasDynamicVars ? recipient : null, hasDynamicVars
      );

      const templateBody: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'template',
        template: {
          name: dispatch.template_name,
          language: { code: dispatch.template_language || 'pt_BR' },
        },
      };

      if (components.length > 0) {
        (templateBody.template as Record<string, unknown>).components = components;
      }

      try {
        const response = await fetch(graphUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(templateBody),
        });

        const data = await response.json();

        if (response.ok) {
          const messageId = data.messages?.[0]?.id || null;
          await Promise.all([
            supabase.from('dispatch_recipients').update({
              status: 'sent', message_wamid: messageId,
            }).eq('id', recipient.id),
            supabase.from('whatsapp_messages').insert({
              phone: formattedPhone,
              message: rendered || `[Template: ${dispatch.template_name}]`,
              direction: 'outgoing',
              message_id: messageId,
              status: 'sent',
              media_type: 'text',
              whatsapp_number_id: dispatch.whatsapp_number_id,
            }),
            supabase.from('chat_finished_conversations').upsert({
              phone: formattedPhone,
              finished_at: new Date().toISOString(),
              finish_reason: 'disparo_msg',
            } as any, { onConflict: 'phone' }),
          ]);
          return true; // sent
        } else {
          console.error(`Failed to send to ${formattedPhone}:`, data.error?.message || JSON.stringify(data));
          await supabase.from('dispatch_recipients').update({ status: 'failed' }).eq('id', recipient.id);
          return false; // failed
        }
      } catch (sendErr) {
        console.error(`Error sending to ${formattedPhone}:`, sendErr);
        await supabase.from('dispatch_recipients').update({ status: 'failed' }).eq('id', recipient.id);
        return false;
      }
    }

    // Process in chunks of CONCURRENCY
    for (let i = 0; i < pendingRecipients.length; i += CONCURRENCY) {
      // Check cancellation every chunk
      if (i > 0 && i % (CONCURRENCY * 5) === 0) {
        const { data: checkDisp } = await supabase
          .from('dispatch_history').select('status').eq('id', dispatchId).single();
        if (checkDisp?.status === 'cancelled') { cancelled = true; break; }
      }

      const chunk = pendingRecipients.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(r => sendOne(r)));
      for (const ok of results) {
        if (ok) batchSent++; else batchFailed++;
      }
    }

    // Update dispatch progress
    const { data: totalCounts } = await supabase
      .from('dispatch_recipients')
      .select('status')
      .eq('dispatch_id', dispatchId);

    const totalSent = (totalCounts || []).filter(r => r.status === 'sent').length;
    const totalFailed = (totalCounts || []).filter(r => r.status === 'failed').length;
    const totalPending = (totalCounts || []).filter(r => r.status === 'pending').length;

    // Release lock
    await supabase.from('dispatch_history').update({
      processing_batch: false,
      sent_count: totalSent,
      failed_count: totalFailed,
    }).eq('id', dispatchId);

    // Self-chain: if there are still pending recipients, trigger next batch
    if (totalPending > 0) {
      const { data: checkStatus } = await supabase
        .from('dispatch_history')
        .select('status')
        .eq('id', dispatchId)
        .single();

      if (checkStatus?.status !== 'cancelled') {
        // Fire and forget the next batch
        const nextUrl = `${supabaseUrl}/functions/v1/dispatch-mass-send`;
        fetch(nextUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ dispatchId }),
        }).catch(err => console.error('Failed to chain next batch:', err));
      }
    } else {
      // Mark as completed
      await supabase.from('dispatch_history').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        sent_count: totalSent,
        failed_count: totalFailed,
      }).eq('id', dispatchId);
    }

    return new Response(JSON.stringify({
      success: true,
      batchSent,
      batchFailed,
      totalPending,
      totalSent,
      totalFailed,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('dispatch-mass-send error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
