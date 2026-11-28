import { DEFAULT_FOLLOWUP_CONFIG, scheduleStep, renderFollowup, stopReason, crossellWindow, type FollowupConfig, type FollowupType } from '../../../supabase/functions/_shared/live-followup-rules.ts';
import { internalCallHeaders } from '../../../supabase/functions/_shared/requireAuth.ts';
import { instagramFollowupMode } from '../../../supabase/functions/_shared/instagram-window.ts';
import { followupFAllowed } from '../../../supabase/functions/_shared/register-dm-rules.ts';
import { cancelScope } from '../../../supabase/functions/_shared/live-followup-cancel-scope.ts';
import { D_STEP_SKIP_REASON, runInstanceLoops } from '../../../supabase/functions/_shared/live-followup-v2.ts';
type Client = any;
const MAX_SCHEDULE_BASE_AGE_MIN = 60;
export async function followupConfig(sb: Client): Promise<FollowupConfig> {
  const { data, error } = await sb.from('live_followup_settings').select('value').eq('id', true).maybeSingle();
  if (error) throw error;
  return data?.value || DEFAULT_FOLLOWUP_CONFIG;
}
/** This gate is deliberately global: the new event switch disables rather than revives old reminders. */
export async function replacesLegacyFollowups(sb: Client): Promise<boolean> {
  return (await followupConfig(sb)).enabled === true;
}
const normalizePhone = (value: string) => {
  let p = String(value || '').replace(/\D/g, '');
  if (p.length === 10 || p.length === 11) p = '55' + p;
  if (p.length === 12 && p.startsWith('55')) p = p.slice(0, 4) + '9' + p.slice(4);
  return /^55[1-9]\d9\d{8}$/.test(p) ? p : '';
};

export async function scheduleGlobalFollowups(sb: Client, simulation?: {eventId:string;offset:number}) {
  const saved = await followupConfig(sb);
  const cfg = simulation ? {...saved,enabled:true,enabled_since:'1970-01-01T00:00:00Z'} : saved;
  if (!cfg.enabled) return { scheduled: 0, enabled: false };
  const { data: sources, error } = await sb.rpc(simulation?'live_followup_audit_contexts':'live_followup_source_contexts', simulation?{p_event_id:simulation.eventId,p_limit:100,p_offset:simulation.offset}:{ p_limit: 50 });
  if (error) throw error;
  let scheduled = 0;
  let deferred = 0;
  const counts: Record<string,number>={A:0,B:0,C:0,D:0,E:0,F:0};
  const senders: Record<string,string[]>={A:[],B:[],C:[],D:[],E:[],F:[]};
  let privateReplies=0, endedPrivateReplies=0;
  for (const source of sources || []) {
    const c = source.context;
    const o = c.order;
    const a = c.access;
    const ev = c.event;
    if (!ev?.live_followup_enabled) { await ack(); continue; }
    const phone = normalizePhone(c.registration?.whatsapp || a?.confirmed_phone || a?.entered_phone || c.customer?.whatsapp || '');
    const ig = String(a?.instagram || c.customer?.instagram_handle || '').replace(/^@/, '').toLowerCase();
    const customer = phone ? 'wa:' + phone.slice(2,4) + phone.slice(-8) : 'ig:' + ig;
    const stopped = o && (o.is_paid || o.paid_externally || ['cancelled','paid','completed','shipped','refunded'].includes(o.stage) || o.merged_into_order_id || !(o.products || []).length);
    if (stopped) { await sb.from('live_followup_jobs').update({status:'cancelled',reason:'order_closed'}).eq('order_id',o.id).eq('status','pending'); await ack(); continue; }
    let type: FollowupType | null = null;
    let base: string | null = null;
    let sequence = o ? 'order:' + o.id : 'access:' + a?.id;
    if (o?.origin === 'catalog' && o.attribution?.source !== 'vitrine_grupo' && c.paid_same_day) { type='E'; base=c.first_item_at || o.created_at; }
    else if (o && (o.selfservice_cart_sent_at || c.cart_sent_at)) { type='D'; base=o.selfservice_cart_sent_at || c.cart_sent_at; }
    // Only customers with an open cart get follow-ups: a registration without an order never does.
    else if (o && a && !a.registered_at && !a.whatsapp_confirmed_at && phone) { type='A'; base=a.created_at; sequence='registration:'+ev.id+':'+customer; }
    else if (o && phone && (a?.registered_at || o.registered_at || c.registration)) {
      type=a?.registered_at && !a.whatsapp_confirmed_at ? 'B':'C'; base=a?.registered_at || o.registered_at || o.created_at;
    } else if (o && !phone && ig && !o.registered_at && o.origin !== 'catalog') { type='F'; base=o.created_at; }
    // No cart exists for a filled registration without an order: never manufacture one.
    if (!type || !base || !cfg.types[type].enabled || !cfg.enabled_since || Date.parse(base)<Date.parse(cfg.enabled_since)) { await ack(); continue; }
    if (!phone && type !== 'F') { await ack(); continue; }
    if (type === 'F' && o?.id) {
      const { data: dms } = await sb.from('ig_live_cart_notifications').select('status').eq('order_id', o.id).eq('kind', 'selfservice_register_dm');
      if (!followupFAllowed((dms || []).map((d: any) => d.status))) { await ack(); continue; }
    }
    // Stale bases (e.g. a source that changed hours later or a recovered backlog) never create late reminders.
    if (!simulation && Date.now() - Date.parse(base) > MAX_SCHEDULE_BASE_AGE_MIN * 60000) { await ack(); continue; }
    // Context uses the same live_event_sender RPC as event-sender.ts, batched in SQL.
    // O fallback do Instagram fica fora da consulta em lote: uma falha afeta só
    // este item, que permanece na fila para nova tentativa sem travar os demais.
    let numberId = type === 'F' ? c.ig_instance_id : ev.whatsapp_number_id;
    let instagramContext: any = null;
    if (type === 'F' && !numberId) {
      try {
        const igctx = await sb.rpc('instagram_reply_context', { p_username: ig, p_event_id: ev.id, p_number_id: null });
        if (igctx.error) throw igctx.error;
        instagramContext = igctx.data;
        numberId = instagramContext?.number_id || null;
      } catch (error) {
        deferred++;
        console.warn('[followup] Instagram context failed; source kept for retry', {
          sourceKey: source.source_key,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    if (!numberId) { await ack(); continue; }
    if(simulation){
      const jobCount=type==='F'?1:cfg.types[type].steps.length;
      counts[type]+=jobCount;
      if(!senders[type].includes(numberId))senders[type].push(numberId);
      if(type==='F') {
        const igctx=instagramContext ? {data:instagramContext,error:null} : await sb.rpc('instagram_reply_context',{p_username:ig,p_event_id:ev.id,p_number_id:numberId});
        if(igctx.error)throw igctx.error;
        const mode=instagramFollowupMode(igctx.data);
        if(mode==='private_reply')privateReplies++;
        if(mode==='live_ended_no_private_reply')endedPrivateReplies++;
      }
      scheduled+=jobCount;continue;
    }
    // B/C are one common initial-cart step, not two independent sequences.
    if (type === 'B' || type === 'C') sequence += ':initial';
    else sequence += ':' + type;
    const rows = (type==='F'?cfg.types.F.steps.slice(0,1):cfg.types[type].steps).map((step,index) => ({
      event_id: ev.id, order_id:o?.id || null, access_id:a?.id || null,
      customer_key:customer, phone:phone || null, instagram:ig || null, whatsapp_number_id:numberId || null,
      channel:type === 'F'?'instagram':'whatsapp', type, step:index, sequence_key:sequence,
      base_at:base, scheduled_at:scheduleStep(new Date(base),type,type==='F' && index===0 ? Math.min(step.minutes,2) : type==='F' ? step.minutes+Math.min(cfg.types.F.steps[0].minutes,2) : step.minutes).toISOString(), status:'pending',
    }));
    const result = await sb.from('live_followup_jobs').upsert(rows,{onConflict:'customer_key,sequence_key,step',ignoreDuplicates:true});
    if (result.error) throw result.error;
    scheduled += rows.length;
    await ack();
    async function ack() {
      if(simulation)return;
      const r = await sb.from('live_followup_sources').delete().eq('source_key',source.source_key).eq('changed_at',source.changed_at);
      if (r.error) throw r.error;
    }
  }
  return {scheduled,enabled:true,deferred,...(simulation?{simulated:true,scanned:sources?.length || 0,counts,senders,privateReplies,endedPrivateReplies,provider_calls:0}:{})};
}
