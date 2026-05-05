import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { token, nps_score, review_comment, improvement_suggestion } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: 'token required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (typeof nps_score !== 'number' || nps_score < 0 || nps_score > 10) {
      return new Response(JSON.stringify({ error: 'nps_score must be 0-10' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data, error } = await supabase
      .from('review_tokens')
      .update({
        nps_score,
        review_comment: review_comment || null,
        improvement_suggestion: improvement_suggestion || null,
        review_submitted_at: new Date().toISOString(),
      })
      .eq('token', token)
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
