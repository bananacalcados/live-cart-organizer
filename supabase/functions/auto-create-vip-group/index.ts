import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Auto-creates a new VIP group for a campaign when all groups are full.
 * Finds a seed participant by looking at admins/participants from existing campaign groups.
 * 
 * Body: { campaign_id: string }
 * Returns: { success, group, invite_link }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
    const zapiToken = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');

    if (!instanceId || !zapiToken || !clientToken) {
      return new Response(
        JSON.stringify({ error: 'Z-API credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: 'campaign_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Fetch campaign
    const { data: campaign, error: campErr } = await supabase
      .from('group_campaigns')
      .select('id, name, target_groups, total_groups')
      .eq('id', campaign_id)
      .single();

    if (campErr || !campaign) {
      return new Response(
        JSON.stringify({ error: 'Campaign not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetGroupIds: string[] = campaign.target_groups || [];

    // 2. Check if there are non-full groups — if so, no need to create
    const { data: nonFullGroups } = await supabase
      .from('whatsapp_groups')
      .select('id')
      .in('id', targetGroupIds.length > 0 ? targetGroupIds : ['__none__'])
      .lt('participant_count', 1000)
      .eq('is_full', false)
      .limit(1);

    if (nonFullGroups && nonFullGroups.length > 0) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'Campaign still has non-full groups' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Find a seed participant from existing campaign groups
    // Get participants from the first active group
    let seedPhone: string | null = null;

    for (const gId of targetGroupIds) {
      const { data: group } = await supabase
        .from('whatsapp_groups')
        .select('group_id')
        .eq('id', gId)
        .single();

      if (!group) continue;

      // Fetch participants via Z-API
      const participantsUrl = `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}/group-participants/${group.group_id}`;
      const partRes = await fetch(participantsUrl, {
        method: 'GET',
        headers: { 'Client-Token': clientToken },
      });

      if (!partRes.ok) continue;
      const participants = await partRes.json();

      if (Array.isArray(participants) && participants.length > 0) {
        // Prefer admins first, then any participant
        const admin = participants.find((p: any) => p.isAdmin || p.isSuperAdmin);
        const candidate = admin || participants.find((p: any) => p.phone);
        if (candidate?.phone) {
          seedPhone = candidate.phone;
          console.log(`Found seed participant ${seedPhone} (admin: ${!!admin}) from group ${group.group_id}`);
          break;
        }
      }
    }

    if (!seedPhone) {
      // Fallback: try Z-API contacts
      const contactsUrl = `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}/contacts?page=1&pageSize=5`;
      const contactsRes = await fetch(contactsUrl, {
        method: 'GET',
        headers: { 'Client-Token': clientToken },
      });
      if (contactsRes.ok) {
        const contacts = await contactsRes.json();
        if (Array.isArray(contacts) && contacts.length > 0) {
          seedPhone = contacts[0].phone;
          console.log(`Using fallback contact as seed: ${seedPhone}`);
        }
      }
    }

    if (!seedPhone) {
      return new Response(
        JSON.stringify({ error: 'Could not find a seed participant for the new group' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Normalize phone for Brazilian numbers
    let normalizedPhone = seedPhone.replace(/\D/g, '');
    if (!normalizedPhone.startsWith('55') && normalizedPhone.length <= 11) {
      normalizedPhone = '55' + normalizedPhone;
    }
    if (normalizedPhone.startsWith('55') && normalizedPhone.length === 12) {
      const ddd = normalizedPhone.substring(2, 4);
      const local = normalizedPhone.substring(4);
      if (['9', '8', '7', '6'].includes(local[0])) {
        normalizedPhone = '55' + ddd + '9' + local;
      }
    }

    // 5. Determine group name based on campaign pattern
    const existingCount = targetGroupIds.length;
    const baseName = campaign.name || 'VIP';
    const nextNumber = existingCount + 1;
    const newGroupName = `#${nextNumber} ${baseName}`;

    console.log(`Creating auto group "${newGroupName}" with seed phone ${normalizedPhone}`);

    // 6. Create group via Z-API
    const createUrl = `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}/create-group`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken,
      },
      body: JSON.stringify({
        autoInvite: true,
        groupName: newGroupName,
        phones: [normalizedPhone],
      }),
    });

    const createData = await createRes.json();
    const newGroupId = createData?.phone || createData?.groupId;

    if (!newGroupId) {
      console.error('Failed to create group:', createData);
      return new Response(
        JSON.stringify({ error: 'Failed to create group', details: createData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Group created: ${newGroupId}`);

    // 7. Set admins-only messages
    const settingsUrl = `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}/update-group-settings`;
    await fetch(settingsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
      body: JSON.stringify({ groupId: newGroupId, settings: { sendMessages: 'admins' } }),
    });

    // 8. Get invite link
    let inviteLink: string | null = null;
    try {
      const inviteUrl = `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}/group-invite-link/${newGroupId}`;
      const inviteRes = await fetch(inviteUrl, {
        method: 'GET',
        headers: { 'Client-Token': clientToken },
      });
      const inviteData = await inviteRes.json();
      inviteLink = inviteData?.invitationLink || inviteData?.link || null;
      console.log(`Invite link: ${inviteLink}`);
    } catch (e) {
      console.error('Error getting invite link:', e);
    }

    // 9. Save group to DB
    const { data: newGroup } = await supabase
      .from('whatsapp_groups')
      .insert({
        group_id: newGroupId,
        name: newGroupName,
        is_vip: true,
        is_active: true,
        participant_count: 1,
        max_participants: 1024,
        invite_link: inviteLink,
        only_admins_send: true,
      })
      .select()
      .single();

    if (!newGroup) {
      return new Response(
        JSON.stringify({ error: 'Group created on WhatsApp but failed to save to DB' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 10. Add to campaign
    const updatedTargetGroups = [...targetGroupIds, newGroup.id];
    await supabase
      .from('group_campaigns')
      .update({
        target_groups: updatedTargetGroups,
        total_groups: updatedTargetGroups.length,
      })
      .eq('id', campaign_id);

    console.log(`Auto-created group "${newGroupName}" and added to campaign "${campaign.name}"`);

    return new Response(
      JSON.stringify({
        success: true,
        group: { id: newGroup.id, group_id: newGroupId, name: newGroupName, invite_link: inviteLink },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error auto-creating group:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
