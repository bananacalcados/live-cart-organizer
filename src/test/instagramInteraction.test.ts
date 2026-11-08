import {describe,it,expect} from 'vitest';
import {isCustomerReply,followupButtonJob,instagramInteractionPayload,clickedFollowupTimes} from '../../supabase/functions/_shared/instagram-interaction';
import {instagramManualMode,instagramMessagingFields,type InstagramWindow} from '../../supabase/functions/_shared/instagram-window';
import {stopReason} from '../../supabase/functions/_shared/live-followup-rules';
const now=Date.parse('2026-11-08T19:00:00Z');
const c:InstagramWindow={window_open:false,window_until:new Date(now-3600000).toISOString(),manual_until:new Date(now+5*86400000).toISOString(),human_agent_approved:true,comment_ids:[],live_comment_ids:[],private_until:null,live_active:false,number_id:'ig'};
describe('Instagram interaction policy',()=>{
 it('quick reply identifies exact job',()=>expect(followupButtonJob(instagramInteractionPayload({message:{quick_reply:{payload:'livef:7851813a-2eb2-4f05-8e32-99aeb4290348'}}}))).toBe('7851813a-2eb2-4f05-8e32-99aeb4290348'));
 it('click does not stop sequence',()=>expect(isCustomerReply({message:{text:'Quero meu link',quick_reply:{payload:'livef:x'}}})).toBe(false));
 it('postback does not stop sequence',()=>expect(isCustomerReply({postback:{payload:'x'}})).toBe(false));
 it('typed text stops F',()=>expect(stopReason('F',{global:true,event:true,type:true,paid:false,cancelled:false,replied:isCustomerReply({message:{text:'Oi'}}),registered:false,manualRecent:false,optedOut:false,lateMinutes:0})).toBe('customer_replied'));
 it('audio stops sequence',()=>expect(isCustomerReply({message:{attachments:[{type:'audio'}]}})).toBe(true));
 it('10 25 45 are measured from click',()=>expect(clickedFollowupTimes(new Date(now)).map(d=>(d.getTime()-now)/60000)).toEqual([10,25,45]));
 it('approved human tag only manual after 24h',()=>expect(instagramMessagingFields(instagramManualMode(c,true,now))).toEqual({messaging_type:'MESSAGE_TAG',tag:'HUMAN_AGENT'}));
 it('automation cannot use human agent',()=>expect(instagramManualMode(c,false,now)).toBe('no_eligible_comment'));
 it('unapproved human cannot extend window',()=>expect(instagramManualMode({...c,human_agent_approved:false},true,now)).toBe('no_eligible_comment'));
 it('7 days boundary is closed',()=>expect(instagramManualMode({...c,manual_until:new Date(now).toISOString()},true,now)).toBe('no_eligible_comment'));
 it('inside 24h manual is ordinary RESPONSE',()=>expect(instagramMessagingFields(instagramManualMode({...c,window_open:true,window_until:new Date(now+3600000).toISOString()},true,now))).toEqual({messaging_type:'RESPONSE'}));
});