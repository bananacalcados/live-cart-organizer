import { describe,it,expect,vi,afterEach,beforeEach } from 'vitest';
import { renderHook,act,cleanup } from '@testing-library/react';
import { MobileSendGate,matchesProviderEcho,reconcileMobileAttempts,type MobileSendAttempt } from '@/lib/chat/mobileSendAttempt';
import { useMobileSend } from '@/mobile/pdv/whatsapp/useMobileSend';
import type { Message } from '@/components/chat/ChatTypes';
const {sendText,sendMedia}=vi.hoisted(()=>({sendText:vi.fn(),sendMedia:vi.fn()}));
vi.mock('@/hooks/chat/useChatSender',()=>({useChatSender:()=>({sendText,sendMedia})}));
vi.mock('@/lib/chat/mobileSupplementalSend',()=>({sendMobileSupplemental:vi.fn()}));
const base={phone:'5533999990000',route:{channel:'whatsapp' as const,provider:'uazapi' as const,numberId:'instance-A'},senderUserId:'seller-A'};
const attempt:MobileSendAttempt={id:'attempt-1',text:'Olá',phone:base.phone,numberId:'instance-A',senderUserId:'seller-A',startedAt:'2026-11-28T13:00:00Z',state:'uncertain'};
const echo:Message={id:'row-1',phone:attempt.phone,whatsapp_number_id:'instance-A',message:'Olá',direction:'outgoing',created_at:'2026-11-28T13:00:03Z',message_id:'provider-1',sender_user_id:'seller-A'};
beforeEach(()=>{vi.useFakeTimers();sessionStorage.clear();sendText.mockReset();sendMedia.mockReset();});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('Opção A — unchanged send path, explicit human resend only',()=>{
 it('locks on first touch synchronously, even before React renders',()=>{const g=new MobileSendGate();expect(g.enter('A')).toBe(true);expect(g.enter('A')).toBe(false);expect(g.enter('B')).toBe(true);g.leave('A');expect(g.enter('A')).toBe(true);});
 it('lost response does not retry on reconnect, even after deadline',async()=>{
  sendText.mockImplementation(()=>new Promise(()=>{}));const {result}=renderHook(()=>useMobileSend([]));
  let pending:Promise<boolean>|undefined;
  await act(async()=>{pending=result.current.send(base,{text:'Olá'});await result.current.send(base,{text:'Olá'});});
  expect(sendText).toHaveBeenCalledTimes(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(30001);});expect(await pending).toBe(false);expect(result.current.attempts[0].state).toBe('uncertain');
  await act(async()=>{window.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(120000);});expect(sendText).toHaveBeenCalledTimes(1);
 });
 it('second explicit touch reaches provider and is not claimed duplicate-safe',async()=>{
  sendText.mockResolvedValueOnce({success:false}).mockResolvedValueOnce({success:true,messageId:'second'});
  const {result}=renderHook(()=>useMobileSend([]));await act(async()=>{await result.current.send(base,{text:'Olá'});});
  const first=result.current.attempts[0];expect(first.state).toBe('uncertain');
  await act(async()=>{await result.current.send(base,first,first.id);});expect(sendText).toHaveBeenCalledTimes(2);expect(result.current.attempts).toHaveLength(2);expect(result.current.attempts[0].superseded).toBe(true);expect(result.current.attempts[1].state).toBe('confirmed');
 });
 it('restoring an uncertain attempt does not dispatch it',()=>{sessionStorage.setItem('m-pdv-wa-uncertain',JSON.stringify([{...attempt,state:'sending'}]));const {result}=renderHook(()=>useMobileSend([]));expect(result.current.attempts[0].state).toBe('uncertain');expect(sendText).not.toHaveBeenCalled();});
 it('echo clears exactly matching target/text/time/sender with a provider ID',()=>{expect(matchesProviderEcho(attempt,echo)).toBe(true);expect(reconcileMobileAttempts([attempt],[echo])[0].state).toBe('confirmed');});
 it.each([
  ['other instance',{whatsapp_number_id:'instance-B'}],['other phone',{phone:'5533999990001'}],['other sender',{sender_user_id:'seller-B'}],['unknown sender',{sender_user_id:null}],['inbound',{direction:'incoming'}],['no provider ID',{message_id:undefined}],['other text',{message:'olá!'}],['late echo',{created_at:'2026-11-28T13:00:30Z'}],['other media',{media_url:'https://example.test/other.jpg',media_type:'image'}]
 ])('never clears an unsafe %s',(_,changes)=>{expect(matchesProviderEcho(attempt,{...echo,...changes})).toBe(false);});
 it('ambiguous identical attempts retain both warnings',()=>expect(reconcileMobileAttempts([attempt,{...attempt,id:'attempt-2'}],[echo]).every(a=>a.state==='uncertain')).toBe(true));
 it('known provider ID proves the same message without guessing sender/time',()=>expect(matchesProviderEcho({...attempt,messageId:'provider-1'},{...echo,sender_user_id:null})).toBe(true));
 it('media and quoted provider ID are preserved in the original send parameters',async()=>{
  sendMedia.mockResolvedValue({success:true,messageId:'photo-1'});const {result}=renderHook(()=>useMobileSend([]));
  await act(async()=>{await result.current.send(base,{text:'Foto',mediaUrl:'https://example.test/photo.jpg',mediaType:'image',quotedMessageId:'quoted-provider'});});
  expect(sendMedia).toHaveBeenCalledWith({...base,mediaUrl:'https://example.test/photo.jpg',mediaType:'image',caption:'Foto',quotedMessageId:'quoted-provider'});
 });
});
