import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Fetch all contacts (paginated - get first 500)
    const allContacts: { phone: string; name: string; short: string }[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore && page <= 5) {
      const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/contacts?page=${page}&pageSize=${pageSize}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Client-Token': clientToken },
      });

      if (!res.ok) {
        console.error('Z-API contacts error:', await res.text());
        break;
      }

      const data = await res.json();
      const contacts = Array.isArray(data) ? data : [];
      
      // Only include contacts that have a name (saved contacts)
      for (const c of contacts) {
        if (c.name || c.short) {
          allContacts.push({
            phone: c.phone,
            name: c.name || c.short || '',
            short: c.short || c.name || '',
          });
        }
      }

      if (contacts.length < pageSize) {
        hasMore = false;
      }
      page++;
    }

    console.log(`Fetched ${allContacts.length} named contacts`);

    return new Response(
      JSON.stringify({ success: true, contacts: allContacts }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
