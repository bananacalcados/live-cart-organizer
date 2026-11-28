import { useEffect,useRef,useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogTitle } from '@/components/ui/dialog';
import { Reply,FileText,Loader2,ArrowDown } from 'lucide-react';
import type { MobileMessage } from '@/lib/chat/mobileWhatsappReads';
import { AudioPlayer } from '@/components/chat/AudioPlayer';
import { CarouselMessageBubble } from '@/components/chat/CarouselMessageBubble';
import { MessageStatusIcon } from '@/components/chat/MessageStatusIcon';
import type { MobileSendAttempt } from '@/lib/chat/mobileSendAttempt';
export function MobileWhatsappMessages({messages,attempts,older,loading,loadOlder,quote,retry}:{messages:MobileMessage[];attempts:MobileSendAttempt[];older:boolean;loading:boolean;loadOlder:()=>Promise<void>;quote:(m:MobileMessage)=>void;retry:(a:MobileSendAttempt)=>void}){
 const parent=useRef<HTMLDivElement>(null);const [lightbox,setLightbox]=useState<string|null>(null);const [nearBottom,setNearBottom]=useState(true);
 const previous=useRef<{first:string|null;last:string|null;height:number}>({first:null,last:null,height:0});
 const virtual=useVirtualizer({count:messages.length,getScrollElement:()=>parent.current,estimateSize:()=>100,overscan:6,getItemKey:i=>messages[i]?.id||i});
 const unseen=attempts.filter(a=>!a.superseded&&(a.state!=='confirmed'||!messages.some(m=>m.message_id&&m.message_id===a.messageId)));
 useEffect(()=>{
 const el=parent.current;if(!el)return;const first=messages[0]?.id||null,last=messages.at(-1)?.id||null;
 if(previous.current.first&&previous.current.first!==first&&previous.current.last===last)el.scrollTop+=el.scrollHeight-previous.current.height;
 else if(nearBottom&&last!==previous.current.last)el.scrollTop=el.scrollHeight;
 previous.current={first,last,height:el.scrollHeight};
 },[messages,virtual.getTotalSize(),nearBottom]);
 return <div ref={parent} aria-label="Histórico da conversa" className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" onScroll={e=>{const el=e.currentTarget;setNearBottom(el.scrollHeight-el.scrollTop-el.clientHeight<120);if(el.scrollTop<24&&older&&!loading)void loadOlder();}}>
 {older&&<Button variant="outline" className="mb-3 h-11 w-full" disabled={loading} onClick={()=>void loadOlder()}>{loading?<Loader2 className="animate-spin"/>:'Mensagens anteriores'}</Button>}
 <div className="relative w-full" style={{height:virtual.getTotalSize()}}>{virtual.getVirtualItems().map(v=>{const m=messages[v.index];const original=m.quoted_message_id?messages.find(q=>q.message_id===m.quoted_message_id):null;
 return <div key={v.key} data-index={v.index} ref={virtual.measureElement} className="absolute left-0 top-0 w-full pb-3" style={{transform:`translateY(${v.start}px)`}}>
 <article className={`max-w-[92%] break-words rounded-lg border p-3 ${m.direction==='outgoing'?'ml-auto border-primary/20 bg-primary/10':'mr-auto bg-card'}`}>
 {original?<div className="mb-2 border-l-2 border-primary bg-muted p-2 text-xs"><strong>{original.direction==='outgoing'?'Você':original.sender_name||'Cliente'}</strong><p className="line-clamp-2">{original.message}</p></div>:m.quoted_message_id?<p className="mb-2 text-xs text-muted-foreground">↩ Resposta a uma mensagem anterior</p>:null}
 {m.sender_name&&<p className="mb-1 text-xs font-bold">{m.sender_name}</p>}
 {m.template_payload&&<CarouselMessageBubble payload={m.template_payload}/>}
 {m.media_url&&(m.media_type==='image'?<Button variant="ghost" className="h-auto w-full p-0" aria-label="Ampliar foto" onClick={()=>setLightbox(m.media_url||null)}><img src={m.media_url} loading="lazy" alt="Foto da conversa" className="max-h-56 w-full rounded-md object-contain"/></Button>:m.media_type==='audio'?<AudioPlayer src={m.media_url}/>:m.media_type==='video'?<video controls preload="none" src={m.media_url} className="max-h-56 w-full"/>:<Button asChild variant="outline" className="h-12 w-full"><a href={m.media_url} target="_blank" rel="noopener noreferrer"><FileText className="mr-2 h-4 w-4"/>Abrir documento</a></Button>)}
 {m.message&&!/^\[(image|audio|áudio|document|video)\]$/.test(m.message)&&<p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{m.message}</p>}
 <div className="flex items-center justify-end gap-2"><time className="text-[11px] text-muted-foreground">{new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time>{m.direction==='outgoing'&&<MessageStatusIcon status={m.status}/>}<Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Responder mensagem" disabled={!m.message_id} onClick={()=>quote(m)}><Reply className="h-4 w-4"/></Button></div>
 </article></div>;
 })}</div>
 {unseen.map(a=><article key={a.id} className="mb-3 ml-auto max-w-[92%] space-y-2 rounded-lg border border-primary/30 bg-primary/10 p-3"><p className="whitespace-pre-wrap break-words text-sm">{a.text}</p>{a.state==='uncertain'?<><p role="status" className="text-sm font-semibold text-destructive">Não confirmada — confira na conversa antes de reenviar</p><Button variant="outline" className="h-11" disabled={!navigator.onLine} onClick={()=>retry(a)}>Reenviar</Button></>:<p className="text-xs text-muted-foreground">{a.state==='sending'?'Enviando…':'Enviada'}</p>}</article>)}
 {!nearBottom&&<Button variant="secondary" size="icon" className="sticky bottom-2 left-full h-11 w-11" aria-label="Mensagens recentes" onClick={()=>{if(parent.current)parent.current.scrollTop=parent.current.scrollHeight;}}><ArrowDown/></Button>}
 <Dialog open={!!lightbox} onOpenChange={o=>{if(!o)setLightbox(null);}}><DialogContent><DialogTitle>Foto</DialogTitle>{lightbox&&<img src={lightbox} alt="Foto ampliada" className="max-h-[80dvh] w-full object-contain"/>}</DialogContent></Dialog>
 </div>;
}
