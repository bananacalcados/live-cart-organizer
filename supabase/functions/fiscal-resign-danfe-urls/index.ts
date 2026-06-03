import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// One-time/maintenance: re-sign existing PDF DANFE URLs after the
// fiscal-documents bucket was switched to private. HTML DANFEs keep using the
// fiscal-render-document wrapper, so they are skipped.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const marker = '/storage/v1/object/public/fiscal-documents/';
    let updated = 0, skipped = 0, failed = 0;

    const { data: docs, error } = await supabase
      .from('fiscal_documents')
      .select('id, danfe_url')
      .ilike('danfe_url', `%${marker}%.pdf`)
      .limit(2000);

    if (error) throw error;

    for (const doc of docs || []) {
      const url: string = (doc as any).danfe_url || '';
      const idx = url.indexOf(marker);
      if (idx < 0) { skipped++; continue; }
      const path = decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
      const { data: signed, error: sErr } = await supabase.storage
        .from('fiscal-documents').createSignedUrl(path, 315360000);
      if (sErr || !signed?.signedUrl) { failed++; continue; }
      const { error: uErr } = await supabase
        .from('fiscal_documents').update({ danfe_url: signed.signedUrl }).eq('id', (doc as any).id);
      if (uErr) failed++; else updated++;
    }

    return new Response(JSON.stringify({ ok: true, updated, skipped, failed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
