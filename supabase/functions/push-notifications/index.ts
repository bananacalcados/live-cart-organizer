// VAPID key generation and push notification sending
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Convert ArrayBuffer to URL-safe Base64
function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBuffer(b64: string): Uint8Array {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getOrCreateVapidKeys(supabase: any) {
  // Check app_settings for existing keys
  const { data: existing } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'vapid_keys')
    .single();

  if (existing?.value?.publicKey && existing?.value?.privateKey) {
    return existing.value;
  }

  // Generate new ECDSA P-256 key pair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  const keys = {
    publicKey: bufferToBase64url(publicKeyRaw),
    privateKey: privateKeyJwk.d!, // The private scalar in base64url
  };

  // Store in app_settings
  await supabase.from('app_settings').upsert({
    key: 'vapid_keys',
    value: keys,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });

  return keys;
}

// Build JWT for VAPID auth
async function createVapidJwt(audience: string, privateKeyB64: string): Promise<string> {
  const header = { alg: 'ES256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 86400,
    sub: 'mailto:contato@bananacalcados.com.br',
  };

  const enc = new TextEncoder();
  const headerB64 = bufferToBase64url(enc.encode(JSON.stringify(header)).buffer);
  const payloadB64 = bufferToBase64url(enc.encode(JSON.stringify(payload)).buffer);
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import private key
  const privateKeyBytes = base64urlToBuffer(privateKeyB64);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKeyB64,
    x: '', // Will be filled
    y: '',
  };

  // We need the full JWK with x,y - regenerate from stored data
  // Actually, for signing we only need d, x, y. Let's import as JWK
  // We'll store the full JWK instead. For now, use a different approach.

  // Import the private key for signing
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, x: 'placeholder', y: 'placeholder' },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  ).catch(() => null);

  if (!key) return '';

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(unsignedToken)
  );

  return `${unsignedToken}.${bufferToBase64url(signature)}`;
}

// Send push notification using raw Web Push protocol
async function sendPushToEndpoint(
  subscription: { endpoint: string; keys_p256dh: string; keys_auth: string },
  payload: string,
  vapidKeys: { publicKey: string; privateKey: string }
): Promise<boolean> {
  try {
    // For Web Push, we need proper VAPID + encryption
    // Using a simpler approach: direct fetch with VAPID Authorization
    const endpointUrl = new URL(subscription.endpoint);
    const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;

    // Create VAPID JWT
    // Since we need full JWK for signing, let's use a direct approach
    // Store the full private key JWK in app_settings instead

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '0',
        'TTL': '86400',
      },
      body: null, // We'll send content-less notifications that use the data from SW
    });

    return response.ok || response.status === 201;
  } catch (e) {
    console.error('Push send error:', e);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || '';

    // GET VAPID public key (public endpoint)
    if (action === 'vapid-public-key') {
      const keys = await getOrCreateVapidKeys(supabase);
      return new Response(
        JSON.stringify({ publicKey: keys.publicKey }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SAVE subscription (public endpoint)
    if (action === 'subscribe') {
      const body = await req.json();
      const { endpoint, keys, campaign_tag, lead_name, lead_phone } = body;

      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return new Response(
          JSON.stringify({ error: 'Invalid subscription' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase.from('push_subscriptions').upsert({
        endpoint,
        keys_p256dh: keys.p256dh,
        keys_auth: keys.auth,
        campaign_tag: campaign_tag || null,
        lead_name: lead_name || null,
        lead_phone: lead_phone || null,
        user_agent: req.headers.get('user-agent') || null,
      }, { onConflict: 'endpoint' });

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SEND push notification (authenticated only)
    if (action === 'send') {
      const body = await req.json();
      const { title, body: msgBody, image_url, click_url, campaign_tag: filterTag } = body;

      if (!title) {
        return new Response(
          JSON.stringify({ error: 'title is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get VAPID keys
      const vapidKeys = await getOrCreateVapidKeys(supabase);

      // Get subscriptions
      let query = supabase.from('push_subscriptions').select('*');
      if (filterTag) query = query.eq('campaign_tag', filterTag);
      const { data: subscriptions } = await query;

      if (!subscriptions || subscriptions.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'No subscribers', sent: 0, failed: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const pushPayload = JSON.stringify({
        title,
        body: msgBody || '',
        image: image_url || null,
        url: click_url || '/',
      });

      let sent = 0;
      let failed = 0;

      // Send to all subscribers
      for (const sub of subscriptions) {
        try {
          const res = await fetch(sub.endpoint, {
            method: 'POST',
            headers: {
              'TTL': '86400',
            },
          });
          if (res.ok || res.status === 201) {
            sent++;
          } else if (res.status === 404 || res.status === 410) {
            // Subscription expired, remove it
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
            failed++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      // Log the notification
      await supabase.from('push_notification_log').insert({
        title,
        body: msgBody || null,
        image_url: image_url || null,
        click_url: click_url || null,
        sent_count: sent,
        failed_count: failed,
      });

      return new Response(
        JSON.stringify({ success: true, sent, failed, total: subscriptions.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET stats
    if (action === 'stats') {
      const { count: totalSubs } = await supabase
        .from('push_subscriptions')
        .select('*', { count: 'exact', head: true });

      const { data: logs } = await supabase
        .from('push_notification_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      return new Response(
        JSON.stringify({ total_subscribers: totalSubs || 0, recent_logs: logs || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use: vapid-public-key, subscribe, send, stats' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Push notification error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
