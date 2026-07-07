import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import { uazapiInstance } from "../_shared/uazapi-credentials.ts";

const PROACTIVE_THRESHOLD = 950;  // criar standby quando algum grupo atingir este número
const STANDBY_MAX_COUNT = 50;     // grupos com menos que isso são considerados "standby"

type GroupCreds =
  | { provider: 'zapi'; instance: string; token: string; clientToken: string }
  | { provider: 'uazapi'; token: string }
  | { provider: 'wasender'; apiKey: string };

function normalizeGroupJid(raw: string): string {
  if (!raw) return raw;
  if (raw.includes('@')) return raw;
  return `${raw.replace(/\D/g, '')}@g.us`;
}

function countFromPayload(data: any): number | null {
  if (!data) return null;
  if (Array.isArray(data?.participants)) return data.participants.length;
  if (Array.isArray(data?.Participants)) return data.Participants.length;
  if (typeof data?.participantsCount === 'number') return data.participantsCount;
  if (typeof data?.size === 'number') return data.size;
  if (Array.isArray(data?.data?.participants)) return data.data.participants.length;
  if (typeof data?.data?.participantsCount === 'number') return data.data.participantsCount;
  return null;
}

// Busca metadata fresca de um grupo respeitando o provedor real da instância.
async function fetchGroupParticipantCount(creds: GroupCreds, groupId: string): Promise<number | null> {
  try {
    if (creds.provider === 'zapi') {
      const url = `https://api.z-api.io/instances/${creds.instance}/token/${creds.token}/light-group-metadata/${groupId}`;
      const res = await fetch(url, { headers: { 'Client-Token': creds.clientToken } });
      if (!res.ok) return null;
      return countFromPayload(await res.json());
    }
    if (creds.provider === 'uazapi') {
      const jid = normalizeGroupJid(groupId);
      const r = await uazapiInstance('/group/info', creds.token, { method: 'POST', body: { groupjid: jid } });
      return r.ok ? countFromPayload(r.data) : null;
    }
    if (creds.provider === 'wasender') {
      const jid = normalizeGroupJid(groupId);
      const res = await fetch(`https://wasenderapi.com/api/groups/${encodeURIComponent(jid)}/metadata`, {
        headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) return null;
      return countFromPayload(await res.json().catch(() => null));
    }
    return null;
  } catch (e) {
    console.error('metadata error:', e);
    return null;
  }
}


serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse({});
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

    // ─── 2. Cache de credenciais por instance_id (multi-provedor) ───
    const credsCache = new Map<string, GroupCreds | null>();
    const fallbackInstance = Deno.env.get('ZAPI_INSTANCE_ID') || '';
    const fallbackToken = Deno.env.get('ZAPI_TOKEN') || '';
    const fallbackClient = Deno.env.get('ZAPI_CLIENT_TOKEN') || '';

    async function getCreds(instanceUuid: string | null): Promise<GroupCreds | null> {
      const key = instanceUuid || '__default__';
      if (credsCache.has(key)) return credsCache.get(key)!;
      let creds: GroupCreds | null = null;
      if (instanceUuid) {
        const { data: wn } = await supabase
          .from('whatsapp_numbers')
          .select('provider, zapi_instance_id, zapi_token, zapi_client_token, uazapi_token, wasender_api_key')
          .eq('id', instanceUuid)
          .maybeSingle();
        if (wn) {
          if (wn.provider === 'uazapi' && wn.uazapi_token) {
            creds = { provider: 'uazapi', token: wn.uazapi_token };
          } else if (wn.provider === 'wasender' && wn.wasender_api_key) {
            creds = { provider: 'wasender', apiKey: wn.wasender_api_key };
          } else if (wn.zapi_instance_id && wn.zapi_token && wn.zapi_client_token) {
            creds = { provider: 'zapi', instance: wn.zapi_instance_id, token: wn.zapi_token, clientToken: wn.zapi_client_token };
          }
        }
      }
      if (!creds && fallbackInstance && fallbackToken && fallbackClient) {
        creds = { provider: 'zapi', instance: fallbackInstance, token: fallbackToken, clientToken: fallbackClient };
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

      // ─── 3. Refrescar participant_count de cada grupo (provider-aware) ───
      for (const group of groups) {
        const creds = await getCreds(group.instance_id);
        if (!creds) {
          console.warn(`Sem credenciais pro grupo ${group.name}`);
          continue;
        }
        const fresh = await fetchGroupParticipantCount(creds, group.group_id);
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
