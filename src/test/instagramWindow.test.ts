import {describe,it,expect} from 'vitest';
import {instagramSendMode,instagramWindowLabel,type InstagramWindow} from '../../supabase/functions/_shared/instagram-window';
const context:InstagramWindow={window_open:false,window_until:null,comment_ids:[],live_comment_ids:['comment-live'],private_until:null,live_active:false,number_id:'ig'};
describe('Instagram real window',()=>{
 it('ended live cannot receive private reply',()=>expect(instagramSendMode(context)).toBe('live_ended_no_private_reply'));
 it('active live comment permits one private reply',()=>expect(instagramSendMode({...context,live_active:true,comment_ids:['comment-live']})).toBe('private_reply'));
 it('later followup without inbound DM is blocked',()=>expect(instagramSendMode({...context,live_active:true,comment_ids:['comment-live']},1)).toBe('meta_window_closed'));
 it('real inbound DM permits ordinary message',()=>expect(instagramSendMode({...context,window_open:true})).toBe('direct_dm'));
 it('known identity alone never opens window',()=>expect(instagramSendMode({...context,live_comment_ids:[]})).toBe('no_eligible_comment'));
 it('expired direct window is not displayed as open',()=>expect(instagramWindowLabel({...context,window_open:true,window_until:'2026-11-07T10:00:00Z'},Date.parse('2026-11-08T10:00:00Z'))).toBe('Sem janela: aguarde ela mandar mensagem'));
});