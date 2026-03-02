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
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
    const token = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');

    if (!instanceId || !token || !clientToken) {
      return new Response(
        JSON.stringify({ error: 'Z-API credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { syncToDb } = await req.json().catch(() => ({ syncToDb: false }));

    // Fetch all groups from Z-API with pagination
    let allGroups: any[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/groups?page=${page}&pageSize=${pageSize}`;
      const res = await fetch(url, {
        headers: { 'Client-Token': clientToken },
      });

      if (!res.ok) {
        const errData = await res.text();
        console.error('Z-API groups error:', errData);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch groups', details: errData }),
          { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await res.json();
      const groups = Array.isArray(data) ? data : [];
      allGroups = allGroups.concat(groups);

      if (groups.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }

      // Safety cap
      if (allGroups.length >= 500) break;
    }

    // Filter only groups (isGroup === true)
    const groupsOnly = allGroups.filter((g: any) => g.isGroup);

    // Fetch profile pictures for groups without photo
    const groupsNeedingPhoto = groupsOnly.filter((g: any) => !g.imgUrl && !g.profileThumbnail);
    
    if (groupsNeedingPhoto.length > 0) {
      console.log(`Fetching profile pictures for ${groupsNeedingPhoto.length} groups...`);
      
      for (const group of groupsNeedingPhoto) {
        try {
          const groupPhone = group.phone || group.id;
          const ppUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}/profile-picture/${groupPhone}`;
          const ppRes = await fetch(ppUrl, {
            headers: { 'Client-Token': clientToken },
          });
          
          if (ppRes.ok) {
            const ppData = await ppRes.json();
            if (ppData?.link || ppData?.imgUrl || ppData?.profilePictureUrl) {
              group.imgUrl = ppData.link || ppData.imgUrl || ppData.profilePictureUrl;
            }
          }
          // Small delay to avoid rate limiting
          await new Promise(r => setTimeout(r, 200));
        } catch (err) {
          console.error(`Error fetching profile pic for ${group.name}:`, err);
        }
      }
    }

    // If syncToDb, upsert to whatsapp_groups table
    if (syncToDb) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const rows = groupsOnly.map((g: any) => ({
        group_id: g.phone || g.id,
        name: g.name || 'Sem nome',
        description: g.description || null,
        photo_url: g.imgUrl || g.profileThumbnail || null,
        participant_count: g.participants?.length || g.size || 0,
        is_admin: g.isAdmin || false,
        instance_id: instanceId,
        last_synced_at: new Date().toISOString(),
      }));

      if (rows.length > 0) {
        // First get current participant counts for delta tracking
        const { data: existingGroups } = await supabase
          .from('whatsapp_groups')
          .select('id, group_id, instance_id, participant_count')
          .eq('instance_id', instanceId);

        const existingMap = new Map(
          (existingGroups || []).map((g: any) => [`${g.group_id}_${g.instance_id}`, g])
        );

        // Upsert groups with previous_participant_count
        const rowsWithPrevious = rows.map((r: any) => {
          const existing = existingMap.get(`${r.group_id}_${r.instance_id}`);
          return {
            ...r,
            previous_participant_count: existing?.participant_count || 0,
          };
        });

        const { error } = await supabase
          .from('whatsapp_groups')
          .upsert(rowsWithPrevious, { onConflict: 'group_id,instance_id', ignoreDuplicates: false });

        if (error) {
          console.error('Error syncing groups to DB:', error);
        } else {
          console.log(`Synced ${rows.length} groups to DB`);

          // Save snapshots for tracking over time
          const { data: updatedGroups } = await supabase
            .from('whatsapp_groups')
            .select('id, participant_count')
            .eq('instance_id', instanceId);

          if (updatedGroups && updatedGroups.length > 0) {
            const snapshots = updatedGroups.map((g: any) => ({
              group_id: g.id,
              participant_count: g.participant_count,
            }));
            await supabase.from('whatsapp_group_snapshots').insert(snapshots);
            console.log(`Saved ${snapshots.length} snapshots`);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, groups: groupsOnly, total: groupsOnly.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error listing groups:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
