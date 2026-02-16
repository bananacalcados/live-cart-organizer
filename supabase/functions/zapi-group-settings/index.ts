import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GroupSettingsRequest {
  action: 'update-photo' | 'update-description' | 'update-name' | 'get-participants';
  groupId: string;
  value?: string; // URL for photo, text for description/name
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
    const token = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');

    if (!instanceId || !token || !clientToken) {
      return new Response(
        JSON.stringify({ error: 'Z-API credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action, groupId, value }: GroupSettingsRequest = await req.json();
    const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;

    let endpoint: string;
    let method = 'POST';
    let body: Record<string, unknown> = {};

    switch (action) {
      case 'update-photo':
        endpoint = `${baseUrl}/update-group-photo`;
        body = { groupId, imageUrl: value };
        break;
      case 'update-description':
        endpoint = `${baseUrl}/update-group-description`;
        body = { groupId, description: value };
        break;
      case 'update-name':
        endpoint = `${baseUrl}/update-group-name`;
        body = { groupId, name: value };
        break;
      case 'get-participants':
        endpoint = `${baseUrl}/group-participants/${groupId}`;
        method = 'GET';
        break;
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Client-Token': clientToken,
        'Content-Type': 'application/json',
      },
    };
    if (method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(endpoint, fetchOptions);
    const data = await res.json();

    if (!res.ok) {
      console.error('Z-API group settings error:', data);
      return new Response(
        JSON.stringify({ error: 'Failed', details: data }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in group settings:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
