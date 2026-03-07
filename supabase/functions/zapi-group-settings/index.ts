import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GroupSettingsRequest {
  action: 'create' | 'update-photo' | 'update-description' | 'update-name' | 'get-participants' |
          'set-messages-admins-only' | 'set-add-admins-only' |
          'add-participant' | 'remove-participant' | 'promote-admin' | 'demote-admin';
  groupId?: string;
  groupName?: string;
  value?: string;
  phone?: string;
  phones?: string[];
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

    const { action, groupId, groupName, value, phone, phones }: GroupSettingsRequest = await req.json();
    const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;

    // Normalize Brazilian phone numbers: ensure 13 digits (55 + DD + 9 + 8 digits)
    const normalizeBrPhone = (p: string): string => {
      let clean = p.replace(/\D/g, '');
      // Add country code if missing
      if (!clean.startsWith('55') && clean.length <= 11) clean = '55' + clean;
      // Brazilian mobile: if 12 digits (55+DD+8), add the 9th digit
      if (clean.startsWith('55') && clean.length === 12) {
        const ddd = clean.substring(2, 4);
        const local = clean.substring(4);
        // Only add 9 for mobile numbers (starting with 9, 8, 7, 6)
        if (['9', '8', '7', '6'].includes(local[0])) {
          clean = '55' + ddd + '9' + local;
        }
      }
      return clean;
    };

    let endpoint: string;
    let method = 'POST';
    let body: Record<string, unknown> = {};

    switch (action) {
      case 'create':
        endpoint = `${baseUrl}/create-group`;
        const normalizedPhones = (phones || []).map(normalizeBrPhone);
        console.log('Creating group with phones:', normalizedPhones);
        body = { 
          autoInvite: true,
          groupName: groupName || value || 'Novo Grupo',
          phones: normalizedPhones,
        };
        break;
      case 'update-photo':
        endpoint = `${baseUrl}/update-group-photo`;
        body = { groupId, groupPhoto: value };
        break;
      case 'update-description':
        endpoint = `${baseUrl}/update-group-description`;
        body = { groupId, groupDescription: value };
        break;
      case 'update-name':
        endpoint = `${baseUrl}/update-group-name`;
        body = { groupId, groupName: value };
        break;
      case 'get-participants':
        endpoint = `${baseUrl}/group-participants/${groupId}`;
        method = 'GET';
        break;
      case 'set-messages-admins-only':
        endpoint = `${baseUrl}/update-group-settings`;
        body = { groupId, settings: { sendMessages: value === 'true' ? 'admins' : 'all' } };
        break;
      case 'set-add-admins-only':
        endpoint = `${baseUrl}/update-group-settings`;
        body = { groupId, settings: { editGroup: value === 'true' ? 'admins' : 'all' } };
        break;
      case 'add-participant':
        endpoint = `${baseUrl}/add-participant`;
        body = { groupId, phone };
        break;
      case 'remove-participant':
        endpoint = `${baseUrl}/remove-participant`;
        body = { groupId, phone };
        break;
      case 'promote-admin':
        endpoint = `${baseUrl}/promote-participant`;
        body = { groupId, phone };
        break;
      case 'demote-admin':
        endpoint = `${baseUrl}/demote-participant`;
        body = { groupId, phone };
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
      JSON.stringify({ success: true, data, groupId: data?.phone || data?.groupId || null }),
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
