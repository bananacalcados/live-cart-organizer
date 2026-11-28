import { useEffect,useRef,useState } from 'react';
import { Camera,Image,FileText,Mic,Send,ShoppingBag,Zap,X,Loader2,Paperclip,Smile,Trash2,Headphones,LayoutTemplate } from 'lucide-react';
import { uploadMediaToStorage } from '@/components/MediaAttachmentPicker';
import { toast } from 'sonner';
import type { AttemptPayload } from '@/lib/chat/mobileSendAttempt';
import type { MobileMessage } from '@/lib/chat/mobileWhatsappReads';
import { getMaxSizeForType,getMaxSizeLabel } from '@/constants/mediaLimits';
interface Props { disabled:boolean; quoted:MobileMessage|null; cancelQuote:()=>void; send:(p:AttemptPayload)=>Promise<boolean>; openCatalog:()=>void; openReplies:()=>void; openTemplates?:()=>void }
const EMOJIS='😀 😂 😍 🥰 😘 😊 😉 🙏 👍 👏 🙌 💪 ❤️ 💛 💚 💜 🔥 ✨ 🎉 🎁 👠 👡 👟 🛍️ 📦 🚚 💳 💰 ✅ ❌ ⏰ 📍 📸 😢 😅 🤩 😎 🤗 👋 💬'.split(' ');
const fmt=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
export function MobileWhatsappComposer({disabled,quoted,cancelQuote,send,openCatalog,openReplies,openTemplates}:Props){
 const [text,setText]=useState('');const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const lock=useRef(false);
 const [recording,setRecording]=useState(false);const [seconds,setSeconds]=useState(0);const recorder=useRef<MediaRecorder|null>(null);const stream=useRef<MediaStream|null>(null);const discard=useRef(false);const sendAfterStop=useRef(false);
 const [sheet,setSheet]=useState<'attach'|'emoji'|null>(null);
 const image=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null),document=useRef<HTMLInputElement>(null),audio=useRef<HTMLInputElement>(null),field=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>()=>{discard.current=true;if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());},[]);
 useEffect(()=>{if(!recording)return;setSeconds(0);const t=setInterval(()=>setSeconds(s=>s+1),1000);return()=>clearInterval(t);},[recording]);
 const pick=(f?:File)=>{if(f)setFile(f);setSheet(null);};
 const submit=async(override?:File)=>{
   const current=override||file;
   if(lock.current||disabled||(!text.trim()&&!current)||!navigator.onLine)return;
   lock.current=true;setBusy(true);
   try{
     const draft=text.trim();let url:string|null=null;let kind:string|undefined;
     if(current){kind=current.type.startsWith('image/')?'image':current.type.startsWith('audio/')?'audio':'document';
       if(kind!=='image'&&current.size>getMaxSizeForType(current.type))throw new Error(`Arquivo muito grande. Limite ${getMaxSizeLabel(current.type)}.`);
       url=await uploadMediaToStorage(current);if(!url)throw new Error('Arquivo não enviado.');
     }
     setText('');setFile(null);
     await send({text:draft||(kind==='audio'?'[áudio]':`[${kind}]`),mediaUrl:url||undefined,mediaType:kind,quotedMessageId:quoted?.message_id||null});cancelQuote();
   }catch(e){toast.error(e instanceof Error?e.message:'Não consegui preparar o envio.');}finally{lock.current=false;setBusy(false);}
 };
 const startRecording=async()=>{
   try{
     if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Gravação indisponível neste navegador');
     stream.current=await navigator.mediaDevices.getUserMedia({audio:true});
     const mime=['audio/webm;codecs=opus','audio/mp4'].find(m=>MediaRecorder.isTypeSupported(m));
     const r=new MediaRecorder(stream.current,mime?{mimeType:mime}:undefined);const chunks:Blob[]=[];
     discard.current=false;sendAfterStop.current=false;
     r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
     r.onstop=()=>{setRecording(false);stream.current?.getTracks().forEach(t=>t.stop());if(discard.current)return;
       const f=new File(chunks,`audio.${r.mimeType.includes('mp4')?'m4a':'webm'}`,{type:r.mimeType});
       // Sending only follows the explicit tap on the green button; cancel discards the recording.
       if(sendAfterStop.current)void submit(f);else setFile(f);};
     recorder.current=r;r.start();setRecording(true);
   }catch(e){toast.error(e instanceof Error?e.message:'Não consegui acessar o microfone.');}
 };
 const stopRecording=(andSend:boolean)=>{sendAfterStop.current=andSend;discard.current=false;recorder.current?.stop();};
 const cancelRecording=()=>{discard.current=true;recorder.current?.stop();};
 const hasContent=!!text.trim()||!!file;
 const attach:[typeof Camera,string,string,()=>void][]=[
   [FileText,'Documento','#7F66FF',()=>document.current?.click()],[Camera,'Câmera','#FF2E74',()=>camera.current?.click()],[Image,'Galeria','#C861FA',()=>image.current?.click()],
   [Headphones,'Áudio','#FF6D2E',()=>audio.current?.click()],[ShoppingBag,'Catálogo','#1DAA61',()=>{setSheet(null);openCatalog();}],[Zap,'Respostas rápidas','#F5B400',()=>{setSheet(null);openReplies();}],
   ...(openTemplates?[[LayoutTemplate,'Modelos API','#0795DC',()=>{setSheet(null);openTemplates();}] as [typeof Camera,string,string,()=>void]]:[]),
 ];
 return <footer className="m-wa-composer shrink-0 px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
  {(quoted||file)&&<div className="mb-1 space-y-1 rounded-2xl bg-white p-2 shadow-sm">
   {quoted&&<div className="flex items-center gap-2 rounded-lg border-l-4 border-[#1DAA61] bg-[#F0F2F5] p-2 text-sm"><p className="min-w-0 flex-1 truncate">{quoted.message}</p><button type="button" className="m-wa-icon" aria-label="Cancelar resposta" onClick={cancelQuote}><X className="h-6 w-6"/></button></div>}
   {file&&<div className="flex items-center gap-2 text-sm"><Paperclip className="h-5 w-5 shrink-0 text-[#54656F]"/><span className="min-w-0 flex-1 truncate">{file.type.startsWith('audio/')?'Áudio gravado':file.name}</span><button type="button" className="m-wa-icon" aria-label="Remover arquivo" onClick={()=>setFile(null)}><X className="h-6 w-6"/></button></div>}
  </div>}
  <div className="flex items-end gap-2">
   {recording?<div className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-2 shadow-sm"><button type="button" className="m-wa-icon text-destructive" aria-label="Cancelar gravação" onClick={cancelRecording}><Trash2 className="h-6 w-6"/></button><span className="h-3 w-3 animate-pulse rounded-full bg-red-500"/><span role="status" className="flex-1 text-base tabular-nums">{fmt(seconds)} · Gravando…</span></div>
   :<div className="flex min-h-12 min-w-0 flex-1 items-end rounded-[24px] bg-white shadow-sm">
     <button type="button" className="m-wa-icon" aria-label="Emojis" onClick={()=>setSheet(sheet==='emoji'?null:'emoji')}><Smile className="h-6 w-6"/></button>
     <textarea ref={field} aria-label="Mensagem" placeholder="Mensagem" value={text} onChange={e=>setText(e.target.value)} rows={1} disabled={busy} className="max-h-32 min-h-12 min-w-0 flex-1 resize-none bg-transparent py-3 text-base outline-none placeholder:text-[#8696A0]"/>
     <button type="button" className="m-wa-icon" aria-label="Anexar" disabled={disabled||busy} onClick={()=>setSheet(sheet==='attach'?null:'attach')}><Paperclip className="h-6 w-6 -rotate-45"/></button>
     {!text.trim()&&<button type="button" className="m-wa-icon" aria-label="Tirar foto" disabled={disabled||busy} onClick={()=>camera.current?.click()}><Camera className="h-6 w-6"/></button>}
   </div>}
   {recording?<button type="button" className="m-wa-fab" aria-label="Enviar áudio" disabled={disabled} onClick={()=>stopRecording(true)}><Send className="h-6 w-6"/></button>
   :hasContent?<button type="button" className="m-wa-fab" aria-label="Enviar mensagem" disabled={disabled||busy} onClick={()=>void submit()}>{busy?<Loader2 className="h-6 w-6 animate-spin"/>:<Send className="h-6 w-6"/>}</button>
   :<button type="button" className="m-wa-fab" aria-label="Gravar áudio" disabled={disabled||busy} onClick={()=>void startRecording()}><Mic className="h-6 w-6"/></button>}
  </div>
  {sheet==='attach'&&<div role="menu" aria-label="Anexar" className="mt-2 grid grid-cols-4 gap-y-4 rounded-2xl bg-white p-4 shadow-lg">
   {attach.map(([Icon,label,color,run])=><button key={label} role="menuitem" type="button" className="flex flex-col items-center gap-1 text-xs text-[#54656F]" onClick={run}><span className="flex h-14 w-14 items-center justify-center rounded-full text-white" style={{background:color}}><Icon className="h-6 w-6"/></span>{label}</button>)}
  </div>}
  {sheet==='emoji'&&<div aria-label="Emojis" className="mt-2 grid grid-cols-8 gap-1 rounded-2xl bg-white p-2 shadow-lg">{EMOJIS.map(e=><button key={e} type="button" className="h-11 text-2xl" onClick={()=>{setText(t=>t+e);field.current?.focus();}}>{e}</button>)}</div>}
  <input ref={image} type="file" accept="image/*" hidden onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}}/>
  <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}}/>
  <input ref={audio} type="file" accept="audio/*" hidden onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}}/>
  <input ref={document} type="file" hidden onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}}/>
 </footer>;
}
