import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROACTIVE_THRESHOLD = 950;  // criar standby quando algum grupo atingir este número
const STANDBY_MAX_COUNT = 50;     // grupos com menos que isso são considerados "standby"

// Busca metadata fresca de um grupo na Z-API e devolve participant_count atual
async function fetchGroupParticipantCount(
  instanceId: string,
  token: string,
  clientToken: string,
  groupPhone: string
): Promise<number | null> {
  try {
    const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/light-group-metadata/${groupPhone}`;
    const res = await fetch(url, { headers: { 'Client-Token': clientToken } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.participants && Array.isArray(data.participants)) return data.participants.length;
    if (typeof data?.participantsCount === 'number') return data.participantsCount;
    return null;
  } catch (e) {
    console.error('Z-API metadata error:', e);
    return null;
  }
}

serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── 1. Descobrir campanhas "ativas" = têm link de redirect ativo ───
    const { data: activeLinks } = await supabase
      .from('group_redirect_links')
      .select('campaign_id')
      .eq('is_active', true);

    const activeCampaignIds = Array.from(
      new Set((activeLinks || []).map((l: any) => l.campaign_id).filter(Boolean))
    );

    if (activeCampaignIds.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Nenhuma campanha ativa com link' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { data: campaigns } = await supabase
      .from('group_campaigns')
      .select('id, name, target_groups')
      .in('id', activeCampaignIds)
      .not('target_groups', 'eq', '{}');

    if (!campaigns || campaigns.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Nenhuma campanha ativa' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ─── 2. Cache de credenciais Z-API por instance_id ───
    const credsCache = new Map<string, { instance: string; token: string; clientToken: string } | null>();
    const fallbackInstance = Deno.env.get('ZAPI_INSTANCE_ID') || '';
    const fallbackToken = Deno.env.get('ZAPI_TOKEN') || '';
    const fallbackClient = Deno.env.get('ZAPI_CLIENT_TOKEN') || '';

    async function getCreds(instanceUuid: string | null) {
      const key = instanceUuid || '__default__';
      if (credsCache.has(key)) return credsCache.get(key)!;
      let creds: { instance: string; token: string; clientToken: string } | null = null;
      if (instanceUuid) {
        const { data: wn } = await supabase
          .from('whatsapp_numbers')
          .select('zapi_instance_id, zapi_token, zapi_client_token')
          .eq('id', instanceUuid)
          .maybeSingle();
        if (wn?.zapi_instance_id && wn?.zapi_token && wn?.zapi_client_token) {
          creds = { instance: wn.zapi_instance_id, token: wn.zapi_token, clientToken: wn.zapi_client_token };
        }
      }
      if (!creds && fallbackInstance && fallbackToken && fallbackClient) {
        creds = { instance: fallbackInstance, token: fallbackToken, clientToken: fallbackClient };
      }
      credsCache.set(key, creds);
      return creds;
    }

    const results: any[] = [];
    const refreshed: string[] = [];

    for (const campaign of campaigns) {
      const targetGroupIds: string[] = campaign.target_groups || [];
      if (targetGroupIds.length === 0) continue;

      const { data: groups } = await supabase
        .from('whatsapp_groups')
        .select('id, group_id, name, instance_id, participant_count, max_participants, is_full')
        .in('id', targetGroupIds);

      if (!groups || groups.length === 0) continue;

      // ─── 3. Refrescar participant_count de cada grupo via Z-API ───
      for (const group of groups) {
        const creds = await getCreds(group.instance_id);
        if (!creds) {
          console.warn(`Sem credenciais Z-API pro grupo ${group.name}`);
          continue;
        }
        const fresh = await fetchGroupParticipantCount(creds.instance, creds.token, creds.clientToken, group.group_id);
        if (fresh === null) continue;

        const max = group.max_participants || 1024;
        const isFull = fresh >= max;
        const changed = fresh !== group.participant_count || isFull !== group.is_full;

        if (changed) {
          await supabase
            .from('whatsapp_groups')
            .update({
              participant_count: fresh,
              is_full: isFull,
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', group.id);
          refreshed.push(`${group.name}: ${group.participant_count}→${fresh}${isFull ? ' (FULL)' : ''}`);
          group.participant_count = fresh;
          group.is_full = isFull;
        }

        // Pequeno respiro pra Z-API
        await new Promise(r => setTimeout(r, 200));
      }

      // ─── 4. Lógica original: criar standby se grupo perto do limite ───
      const standbyGroups = groups.filter((g: any) => g.participant_count < STANDBY_MAX_COUNT);
      const hasStandby = standbyGroups.length > 0;

      const nearFullGroups = groups.filter((g: any) =>
        !g.is_full && g.participant_count >= PROACTIVE_THRESHOLD
      );
      const hasNearFullGroup = nearFullGroups.length > 0;

      if (hasNearFullGroup && !hasStandby) {
        console.log(`Campanha "${campaign.name}": grupo perto de ${PROACTIVE_THRESHOLD}, criando standby...`);
        try {
          const autoCreateRes = await fetch(`${supabaseUrl}/functions/v1/auto-create-vip-group`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
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
          console.error(`Erro ao criar standby para ${campaign.name}:`, e);
          results.push({ campaign: campaign.name, action: 'error', error: String(e) });
        }
      } else {
        results.push({
          campaign: campaign.name,
          action: 'no_standby_needed',
          reason: hasStandby
            ? `standby existe (${standbyGroups[0].name})`
            : 'nenhum grupo próximo do limite',
        });
      }
    }

    return new Response(JSON.stringify({ success: true, refreshed, results }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Erro no cron:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
