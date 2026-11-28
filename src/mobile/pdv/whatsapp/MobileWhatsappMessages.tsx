import { useEffect,useRef,useState,type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Dialog,DialogContent,DialogTitle } from '@/components/ui/dialog';
import { Reply,FileText,Loader2,ChevronDown,Clock,Play,Pause } from 'lucide-react';
import type { MobileMessage } from '@/lib/chat/mobileWhatsappReads';
import { CarouselMessageBubble } from '@/components/chat/CarouselMessageBubble';
import { MessageStatusIcon } from '@/components/chat/MessageStatusIcon';
import type { MobileSendAttempt } from '@/lib/chat/mobileSendAttempt';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { QuotedHistory } from './quotedHistory';
export function MobileWhatsappMessages({messages:recent,attempts,older,loading,loadOlder,quote,retry,readOriginal}:{messages:MobileMessage[];attempts:MobileSendAttempt[];older:boolean;loading:boolean;loadOlder:()=>Promise<void>;quote:(m:MobileMessage)=>void;retry:(a:MobileSendAttempt)=>void;readOriginal:(providerId:string)=>Promise<QuotedHistory|null>}){
 const [focused,setFocused]=useState<MobileMessage[]|null>(null),[highlight,setHighlight]=useState<string|null>(null),[locating,setLocating]=useState(false);
 const messages=focused||recent;const jumpLock=useRef(false);const highlightTimer=useRef<ReturnType<typeof setTimeout>>();
 useEffect(()=>()=>clearTimeout(highlightTimer.current),[]);
 const parent=useRef<HTMLDivElement>(null);const [lightbox,setLightbox]=useState<string|null>(null);const [nearBottom,setNearBottom]=useState(true);
 const previous=useRef<{first:string|null;last:string|null;height:number}>({first:null,last:null,height:0});
 const virtual=useVirtualizer({count:messages.length,getScrollElement:()=>parent.current,estimateSize:()=>100,overscan:6,getItemKey:i=>messages[i]?.id||i});
 const unseen=attempts.filter(a=>!a.superseded&&(a.state!=='confirmed'||!messages.some(m=>m.message_id&&m.message_id===a.messageId)));
 useEffect(()=>{
 const el=parent.current;if(!el)return;const first=messages[0]?.id||null,last=messages.at(-1)?.id||null;
 if(previous.current.first&&previous.current.first!==first&&previous.current.last===last)el.scrollTop+=el.scrollHeight-previous.current.height;
 else if(nearBottom&&!highlight&&last!==previous.current.last)el.scrollTop=el.scrollHeight;
 previous.current={first,last,height:el.scrollHeight};
 },[messages,virtual.getTotalSize(),nearBottom,highlight]);
 useEffect(()=>{if(!highlight)return;const index=messages.findIndex(m=>m.id===highlight);if(index<0)return;
 const frame=requestAnimationFrame(()=>virtual.scrollToIndex(index,{align:'center'}));return()=>cancelAnimationFrame(frame);
 },[highlight,messages,virtual]);
 const jump=async(providerId:string)=>{
  if(jumpLock.current)return;jumpLock.current=true;setLocating(true);
  try{let id=messages.find(m=>m.message_id===providerId)?.id;
   if(!id){const context=await readOriginal(providerId);if(!context){toast.info('Mensagem original não disponível');return;}setFocused(context.messages);id=context.originalId;}
   setNearBottom(false);setHighlight(id);clearTimeout(highlightTimer.current);highlightTimer.current=setTimeout(()=>setHighlight(null),1800);
  }catch{toast.error('Não consegui carregar a mensagem original. Tente novamente.');}finally{jumpLock.current=false;setLocating(false);}
 };
 const dayOf=(iso:string)=>new Date(iso).toDateString();
 return <div ref={parent} aria-label="Histórico da conversa" className="m-wa-wallpaper relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2" onScroll={e=>{const el=e.currentTarget;setNearBottom(el.scrollHeight-el.scrollTop-el.clientHeight<120);if(!focused&&el.scrollTop<24&&older&&!loading&&!highlight)void loadOlder();}}>
 {focused?<Button variant="ghost" className="m-wa-day sticky top-0 z-10 min-h-11" onClick={()=>{setFocused(null);setHighlight(null);setNearBottom(true);}}>Voltar às mensagens recentes</Button>:older&&<button type="button" className="m-wa-day mb-2 block min-h-11" disabled={loading} onClick={()=>void loadOlder()}>{loading?<Loader2 className="h-4 w-4 animate-spin"/>:'Mensagens anteriores'}</button>}
 {locating&&<p role="status" className="m-wa-day">Buscando mensagem original…</p>}
 <div className="relative w-full" style={{height:virtual.getTotalSize()}}>{virtual.getVirtualItems().map(v=>{const m=messages[v.index];const prev=messages[v.index-1];const original=m.quoted_message_id?messages.find(q=>q.message_id===m.quoted_message_id):null;
 const out=m.direction==='outgoing';const newDay=!prev||dayOf(prev.created_at)!==dayOf(m.created_at);const tail=newDay||prev.direction!==m.direction;
 return <div key={v.key} data-index={v.index} ref={virtual.measureElement} className={`absolute left-0 top-0 w-full ${tail?'pt-2':'pt-0.5'}`} style={{transform:`translateY(${v.start}px)`}}>
 {newDay&&<p className="m-wa-day">{dayLabel(m.created_at)}</p>}
 <SwipeReply enabled={!!m.message_id} onReply={()=>quote(m)} out={out}>
 <article data-message-id={m.id} data-highlight={m.id===highlight} className={`m-wa-bubble break-words ${out?'out':'in'} ${tail?'tail':''}`}>
 {m.quoted_message_id&&<Button variant="ghost" disabled={locating} aria-label="Ir à mensagem original" onClick={()=>void jump(m.quoted_message_id||'')} className={`m-wa-quote mb-1 h-auto min-h-11 w-full justify-start whitespace-normal rounded-md border-l-4 p-2 text-left text-[13px] ${original?.direction==='outgoing'?'border-[var(--wa-brand)]':'border-[var(--wa-violet)]'}`}><span><strong className="text-[var(--wa-brand)]">{original?(original.direction==='outgoing'?'Você':original.sender_name||'Cliente'):'Mensagem anterior'}</strong><span className="block line-clamp-2 text-[var(--wa-icon)]">{original?.message||'Toque para ver a mensagem original'}</span></span></Button>}
 {m.is_group&&!out&&m.sender_name&&<p className="text-[13px] font-semibold text-[var(--wa-violet)]">{m.sender_name}</p>}
 {m.template_payload&&<CarouselMessageBubble payload={m.template_payload}/>}
 {m.media_url&&(m.media_type==='image'?<button type="button" className="block w-full" aria-label="Ampliar foto" onClick={()=>setLightbox(m.media_url||null)}><img src={m.media_url} loading="lazy" alt="Foto da conversa" className="max-h-64 w-full rounded-md object-cover"/></button>:m.media_type==='audio'?<WaAudio src={m.media_url} out={out}/>:m.media_type==='video'?<video controls preload="none" src={m.media_url} className="max-h-64 w-full rounded-md"/>:<a href={m.media_url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center gap-2 rounded-md m-wa-quote px-3"><FileText className="h-6 w-6 text-[var(--wa-icon)]"/>Abrir documento</a>)}
 {m.message&&!/^\[(image|audio|áudio|document|video)\]$/.test(m.message)&&<span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.message}</span>}
 <span className="m-wa-meta"><time>{new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time>{out&&<span data-read={['read','read_by_me','played'].includes(m.status||'')}><MessageStatusIcon status={m.status} className="h-4 w-4"/></span>}</span>
 </article></SwipeReply></div>;
 })}</div>
 {!focused&&unseen.map(a=><div key={a.id} className="pt-2"><article className="m-wa-bubble out tail space-y-1"><p className="whitespace-pre-wrap break-words">{a.text}</p>{a.state==='uncertain'?<><p role="status" className="text-[13px] font-semibold text-destructive">Não confirmada — confira na conversa antes de reenviar</p><button type="button" className="min-h-11 rounded-full border border-destructive px-4 text-sm font-semibold text-destructive" disabled={!navigator.onLine} onClick={()=>retry(a)}>Reenviar</button></>:<span className="m-wa-meta">{a.state==='sending'?<><Clock className="h-3.5 w-3.5"/>Enviando…</>:'Enviada'}</span>}</article></div>)}
 {(!nearBottom||focused)&&<button type="button" className="sticky bottom-2 left-full flex h-11 w-11 items-center justify-center rounded-full m-wa-surface text-[var(--wa-icon)] shadow" aria-label="Mensagens recentes" onClick={()=>{setFocused(null);setHighlight(null);setNearBottom(true);if(parent.current)parent.current.scrollTop=parent.current.scrollHeight;}}><ChevronDown/></button>}
 <Dialog open={!!lightbox} onOpenChange={o=>{if(!o)setLightbox(null);}}><DialogContent><DialogTitle>Foto</DialogTitle>{lightbox&&<img src={lightbox} alt="Foto ampliada" className="max-h-[80dvh] w-full object-contain"/>}</DialogContent></Dialog>
 </div>;
}

function dayLabel(iso:string){const d=new Date(iso);const today=new Date();const y=new Date();y.setDate(today.getDate()-1);
 if(d.toDateString()===today.toDateString())return 'Hoje';if(d.toDateString()===y.toDateString())return 'Ontem';
 return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});}

/** Reply by swiping the bubble sideways or by long-press (500 ms); keyboard users get Enter/space via the menu-less focus target. */
function SwipeReply({enabled,onReply,out,children}:{enabled:boolean;onReply:()=>void;out:boolean;children:ReactNode}){
 const start=useRef<{x:number;y:number}|null>(null);const timer=useRef<ReturnType<typeof setTimeout>>();const [dx,setDx]=useState(0);const fired=useRef(false);
 const end=()=>{clearTimeout(timer.current);if(dx>60&&!fired.current&&enabled)onReply();start.current=null;setDx(0);};
 return <div className={`relative flex ${out?'justify-end':'justify-start'}`} style={{transform:dx?`translateX(${dx}px)`:undefined,transition:dx?undefined:'transform .15s'}}
  onTouchStart={e=>{if(!enabled)return;const t=e.touches[0];start.current={x:t.clientX,y:t.clientY};fired.current=false;timer.current=setTimeout(()=>{fired.current=true;navigator.vibrate?.(30);onReply();},500);}}
  onTouchMove={e=>{if(!start.current)return;const t=e.touches[0];const x=t.clientX-start.current.x,y=Math.abs(t.clientY-start.current.y);if(Math.abs(x)>8||y>8)clearTimeout(timer.current);if(y<30&&x>0)setDx(Math.min(x,80));}}
  onTouchEnd={end} onTouchCancel={end} onContextMenu={e=>{if(enabled){e.preventDefault();}}}>
  {dx>20&&<Reply className="absolute left-0 top-1/2 h-5 w-5 -translate-x-7 -translate-y-1/2 text-[var(--wa-icon)]"/>}
  {children}
 </div>;
}

function WaAudio({src,out}:{src:string;out:boolean}){
 const ref=useRef<HTMLAudioElement>(null);const [playing,setPlaying]=useState(false);const [time,setTime]=useState(0);const [duration,setDuration]=useState(0);
 const fmt=(s:number)=>Number.isFinite(s)?`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`:'0:00';
 const bars=[4,9,6,12,8,14,10,6,12,16,9,5,11,14,7,10,13,6,9,4,8,12,6,10];
 const progress=duration?time/duration:0;
 return <div className="flex min-w-[220px] items-center gap-2 py-1">
  <button type="button" aria-label={playing?'Pausar áudio':'Tocar áudio'} className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--wa-icon)]" onClick={()=>{const a=ref.current;if(!a)return;if(a.paused)void a.play();else a.pause();}}>{playing?<Pause className="h-7 w-7 fill-current"/>:<Play className="h-7 w-7 fill-current"/>}</button>
  <div className="flex-1"><div className="relative flex h-6 items-center gap-[2px]" onClick={e=>{const a=ref.current;if(!a||!duration)return;const r=e.currentTarget.getBoundingClientRect();a.currentTime=((e.clientX-r.left)/r.width)*duration;}}>
   {bars.map((h,i)=><span key={i} className="w-[3px] rounded-full" style={{height:h,background:i/bars.length<progress?(out?'var(--wa-brand)':'var(--wa-read)'):'var(--wa-wave)'}}/>)}
  </div><span className="text-[11px] text-[var(--wa-secondary)]">{fmt(playing||time?time:duration)}</span></div>
  <audio ref={ref} src={src} preload="metadata" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{setPlaying(false);setTime(0);}} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDuration(e.currentTarget.duration)}/>
 </div>;
}
