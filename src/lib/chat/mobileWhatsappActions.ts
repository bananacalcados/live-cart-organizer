import { supabase } from '@/integrations/supabase/client';
import { laneAutoKey } from './conversationLanes';
import { setFinishedLocal } from '@/lib/finishedConversationsCache';
export async function markMobileConversationRead(phone:string,numberId:string|null){
 let q=supabase.from('whatsapp_messages').update({status:'read'}).eq('phone',phone).eq('direction','incoming').neq('status','read');
 q=numberId?q.eq('whatsapp_number_id',numberId):q.is('whatsapp_number_id',null);
 const {error}=await q;if(error)throw error;
}
export async function moveMobileConversationLane(phone:string,numberId:string|null,lane:'new'|'unread'|'followup'|'live'|'support'){
 const key=laneAutoKey(phone);if(key.length<8)return;
 const {data:auth}=await supabase.auth.getUser();
 const {error}=await supabase.from('chat_conversation_lanes').upsert({phone_key:key,whatsapp_number_id:numberId||'',lane,moved_by:auth.user?.id||null,moved_at:new Date().toISOString()},{onConflict:'phone_key,whatsapp_number_id'});
 if(error)throw error;
}
export async function assignMobileConversation(phone:string,numberId:string|null,userId:string,name:string|null){
 const {data:{user}}=await supabase.auth.getUser();
 const {error}=await supabase.from('chat_conversation_assignments').upsert({phone,whatsapp_number_id:numberId,assigned_to:userId,assigned_name:name,assigned_by:user?.id||null},{onConflict:'phone,whatsapp_number_id'});
 if(error)throw error;
}
export async function reopenMobileConversation(phone:string,numberId:string|null){
 const {error}=await supabase.rpc('reopen_finished_conversation',{p_phone:phone,p_whatsapp_number_id:numberId||undefined});
 if(error)throw error;setFinishedLocal(phone,numberId,null);
}
export async function recordMobileReply(phone:string,sellerId:string|null){
 if(sellerId)await supabase.from('chat_seller_assignments').update({first_reply_at:new Date().toISOString()}).eq('phone',phone).eq('seller_id',sellerId).is('first_reply_at',null);
 await supabase.from('chat_assignments').update({status:'resolved',resolved_at:new Date().toISOString()}).eq('phone',phone).eq('assigned_by','ai').eq('status','pending');
}
