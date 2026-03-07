import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // 1. Fetch campaign with template settings
    const { data: campaign, error: campErr } = await supabase
      .from('group_campaigns')
      .select('id, name, target_groups, total_groups, group_name_template, group_photo_url, group_description, group_only_admins_send, group_only_admins_add, group_admin_phones, group_pin_message_id, group_pin_duration')
      .eq('id', campaign_id)
      .single();

    if (campErr || !campaign) {
      return new Response(
        JSON.stringify({ error: 'Campaign not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetGroupIds: string[] = campaign.target_groups || [];

    // 2. Check if there are non-full groups
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
    let seedPhone: string | null = null;

    // First try admin phones from campaign settings
    const adminPhones: string[] = (campaign as any).group_admin_phones || [];
    if (adminPhones.length > 0) {
      seedPhone = adminPhones[0];
      console.log(`Using saved admin phone as seed: ${seedPhone}`);
    }

    // If no saved admin, look at existing groups
    if (!seedPhone) {
      for (const gId of targetGroupIds) {
        const { data: group } = await supabase
          .from('whatsapp_groups')
          .select('group_id')
          .eq('id', gId)
          .single();

        if (!group) continue;

        const participantsUrl = `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}/group-participants/${group.group_id}`;
        const partRes = await fetch(participantsUrl, {
          method: 'GET',
          headers: { 'Client-Token': clientToken },
        });

        if (!partRes.ok) continue;
        const participants = await partRes.json();

        if (Array.isArray(participants) && participants.length > 0) {
          const admin = participants.find((p: any) => p.isAdmin || p.isSuperAdmin);
          const candidate = admin || participants.find((p: any) => p.phone);
          if (candidate?.phone) {
            seedPhone = candidate.phone;
            console.log(`Found seed participant ${seedPhone} (admin: ${!!admin}) from group ${group.group_id}`);
            break;
          }
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

    // 4. Normalize phone
    const normalizeBrPhone = (p: string): string => {
      let clean = p.replace(/\D/g, '');
      if (!clean.startsWith('55') && clean.length <= 11) clean = '55' + clean;
      if (clean.startsWith('55') && clean.length === 12) {
        const ddd = clean.substring(2, 4);
        const local = clean.substring(4);
        if (['9', '8', '7', '6'].includes(local[0])) {
          clean = '55' + ddd + '9' + local;
        }
      }
      return clean;
    };

    const normalizedPhone = normalizeBrPhone(seedPhone);

    // 5. Determine group name from saved template or campaign name
    const existingCount = targetGroupIds.length;
    const baseName = (campaign as any).group_name_template || campaign.name || 'VIP';
    const nextNumber = existingCount + 1;
    const newGroupName = `${baseName} #${nextNumber}`;

    console.log(`Creating auto group "${newGroupName}" with seed phone ${normalizedPhone}`);

    // 6. Create group via Z-API
    const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}`;
    const createRes = await fetch(`${baseUrl}/create-group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
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

    // 7. Apply saved campaign settings
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Set permissions
    const sendMsgMode = (campaign as any).group_only_admins_send ? 'admins' : 'all';
    await fetch(`${baseUrl}/update-group-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
      body: JSON.stringify({ groupId: newGroupId, settings: { sendMessages: sendMsgMode } }),
    });
    await delay(1000);

    const addMode = (campaign as any).group_only_admins_add ? 'admins' : 'all';
    await fetch(`${baseUrl}/update-group-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
      body: JSON.stringify({ groupId: newGroupId, settings: { editGroup: addMode } }),
    });
    await delay(1000);

    // Set photo if configured
    if ((campaign as any).group_photo_url) {
      await fetch(`${baseUrl}/update-group-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
        body: JSON.stringify({ groupId: newGroupId, groupPhoto: (campaign as any).group_photo_url }),
      });
      await delay(1000);
    }

    // Set description if configured
    if ((campaign as any).group_description) {
      await fetch(`${baseUrl}/update-group-description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
        body: JSON.stringify({ groupId: newGroupId, groupDescription: (campaign as any).group_description }),
      });
      await delay(1000);
    }

    // Add and promote admin phones
    for (const adminPhone of adminPhones) {
      const normalized = normalizeBrPhone(adminPhone);
      // Skip if it's the seed phone (already in the group)
      if (normalized === normalizedPhone) {
        // Just promote
        await fetch(`${baseUrl}/promote-participant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
          body: JSON.stringify({ groupId: newGroupId, phone: normalized }),
        });
      } else {
        // Add first, then promote
        await fetch(`${baseUrl}/add-participant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
          body: JSON.stringify({ groupId: newGroupId, phone: normalized }),
        });
        await delay(1500);
        await fetch(`${baseUrl}/promote-participant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
          body: JSON.stringify({ groupId: newGroupId, phone: normalized }),
        });
      }
      await delay(1000);
    }

    // 8. Get invite link
    let inviteLink: string | null = null;
    try {
      const inviteRes = await fetch(`${baseUrl}/group-invite-link/${newGroupId}`, {
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
        participant_count: 1 + adminPhones.length,
        max_participants: 1024,
        invite_link: inviteLink,
        only_admins_send: (campaign as any).group_only_admins_send || false,
        only_admins_add: (campaign as any).group_only_admins_add || false,
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

    console.log(`Auto-created group "${newGroupName}" with all campaign settings applied`);

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
