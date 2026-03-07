import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROACTIVE_THRESHOLD = 950;  // criar standby quando algum grupo atingir este número
const STANDBY_MAX_COUNT = 50;     // grupos com menos que isso são considerados "standby"

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Buscar todas as campanhas ativas que têm grupos
    const { data: campaigns } = await supabase
      .from('group_campaigns')
      .select('id, name, target_groups')
      .not('target_groups', 'eq', '{}');

    if (!campaigns || campaigns.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Nenhuma campanha ativa' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const results = [];

    for (const campaign of campaigns) {
      const targetGroupIds: string[] = campaign.target_groups || [];
      if (targetGroupIds.length === 0) continue;

      // Buscar todos os grupos desta campanha
      const { data: groups } = await supabase
        .from('whatsapp_groups')
        .select('id, name, participant_count, max_participants, is_full')
        .in('id', targetGroupIds);

      if (!groups || groups.length === 0) continue;

      // Verificar se já existe um grupo standby (poucos participantes)
      const standbyGroups = groups.filter(g => g.participant_count < STANDBY_MAX_COUNT);
      const hasStandby = standbyGroups.length > 0;

      // Verificar se algum grupo atingiu o threshold proativo
      const nearFullGroups = groups.filter(g => 
        !g.is_full && g.participant_count >= PROACTIVE_THRESHOLD
      );
      const hasNearFullGroup = nearFullGroups.length > 0;

      if (hasNearFullGroup && !hasStandby) {
        // Criar novo grupo standby proativamente
        console.log(`Campanha "${campaign.name}": grupo próximo de ${PROACTIVE_THRESHOLD}, criando standby...`);
        
        try {
          const autoCreateRes = await fetch(`${supabaseUrl}/functions/v1/auto-create-vip-group`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ campaign_id: campaign.id }),
          });
          const result = await autoCreateRes.json();
          results.push({
            campaign: campaign.name,
            action: 'created_standby',
            success: result.success,
            group: result.group?.name || null,
          });
        } catch (e) {
          console.error(`Erro ao criar standby para campanha ${campaign.name}:`, e);
          results.push({ campaign: campaign.name, action: 'error', error: String(e) });
        }
      } else {
        results.push({
          campaign: campaign.name,
          action: 'no_action_needed',
          reason: hasStandby 
            ? `standby já existe (${standbyGroups[0].name})` 
            : 'nenhum grupo próximo do limite',
        });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Erro no cron:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
