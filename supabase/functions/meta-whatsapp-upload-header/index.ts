import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Uploads a sample media file to Meta and returns a header_handle, which is
// required when creating a template with a media HEADER (IMAGE/VIDEO/DOCUMENT).
// Flow (Meta Resumable Upload API):
//   1. Resolve the App ID from the access token (debug_token).
//   2. Create an upload session: POST /{appId}/uploads
//   3. Upload the bytes: POST /{uploadSessionId}  -> returns { h: "<handle>" }
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { whatsappNumberId, fileName, fileType, fileBase64 } = body;

    if (!fileBase64 || !fileType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: fileType, fileBase64' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve access token (specific number first, fallback to default).
    let accessToken = '';
    if (whatsappNumberId) {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('access_token')
        .eq('id', whatsappNumberId)
        .eq('is_active', true)
        .maybeSingle();
      if (data?.access_token) accessToken = data.access_token;
    }
    if (!accessToken) {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('access_token')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      if (data?.access_token) accessToken = data.access_token;
    }
    if (!accessToken) {
      accessToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN') || '';
    }
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'WhatsApp credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode base64 (strip data URL prefix if present)
    const cleanB64 = String(fileBase64).includes(',')
      ? String(fileBase64).split(',')[1]
      : String(fileBase64);
    const binary = Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0));
    const fileLength = binary.byteLength;

    // 1) Resolve App ID from the access token.
    let appId = Deno.env.get('META_APP_ID') || '';
    if (!appId) {
      const dbgRes = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(accessToken)}`
      );
      const dbg = await dbgRes.json();
      appId = dbg?.data?.app_id || '';
      if (!appId) {
        console.error('Could not resolve App ID from token:', dbg);
        return new Response(
          JSON.stringify({ error: 'Não foi possível resolver o App ID da Meta a partir do token.', details: dbg }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 2) Create upload session.
    const sessionUrl = `https://graph.facebook.com/v21.0/${appId}/uploads?file_name=${encodeURIComponent(fileName || 'upload')}&file_length=${fileLength}&file_type=${encodeURIComponent(fileType)}&access_token=${encodeURIComponent(accessToken)}`;
    const sessionRes = await fetch(sessionUrl, { method: 'POST' });
    const sessionData = await sessionRes.json();
    if (!sessionRes.ok || !sessionData?.id) {
      console.error('Meta upload session error:', sessionData);
      return new Response(
        JSON.stringify({ error: 'Falha ao criar sessão de upload na Meta', details: sessionData }),
        { status: sessionRes.status || 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3) Upload the bytes.
    const uploadRes = await fetch(
      `https://graph.facebook.com/v21.0/${sessionData.id}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `OAuth ${accessToken}`,
          'file_offset': '0',
          'Content-Type': 'application/octet-stream',
        },
        body: binary,
      }
    );
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData?.h) {
      console.error('Meta upload error:', uploadData);
      return new Response(
        JSON.stringify({ error: 'Falha ao enviar o arquivo para a Meta', details: uploadData }),
        { status: uploadRes.status || 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, handle: uploadData.h }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error uploading header media:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
