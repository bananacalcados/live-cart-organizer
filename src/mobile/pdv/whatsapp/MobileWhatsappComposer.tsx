import { useEffect,useRef,useState } from 'react';
import { Camera,Image,FileText,Mic,Square,Send,ShoppingBag,Zap,X,Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { uploadMediaToStorage } from '@/components/MediaAttachmentPicker';
import { toast } from 'sonner';
import type { AttemptPayload } from '@/lib/chat/mobileSendAttempt';
import type { MobileMessage } from '@/lib/chat/mobileWhatsappReads';
import { getMaxSizeForType,getMaxSizeLabel } from '@/constants/mediaLimits';
interface Props { disabled:boolean; quoted:MobileMessage|null; cancelQuote:()=>void; send:(p:AttemptPayload)=>Promise<boolean>; openCatalog:()=>void; openReplies:()=>void; openTemplates?:()=>void }
export function MobileWhatsappComposer({disabled,quoted,cancelQuote,send,openCatalog,openReplies,openTemplates}:Props){
 const [text,setText]=useState('');const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const lock=useRef(false);
 const [recording,setRecording]=useState(false);const recorder=useRef<MediaRecorder|null>(null);const stream=useRef<MediaStream|null>(null);
 const image=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null),document=useRef<HTMLInputElement>(null);
 useEffect(()=>()=>{if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());},[]);
 const pick=(f?:File)=>{if(f)setFile(f);};
 const record=async()=>{
   if(recording){recorder.current?.stop();return;}
   try{
     if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Gravação indisponível neste navegador');
     stream.current=await navigator.mediaDevices.getUserMedia({audio:true});
     const mime=['audio/webm;codecs=opus','audio/mp4'].find(m=>MediaRecorder.isTypeSupported(m));
     const r=new MediaRecorder(stream.current,mime?{mimeType:mime}:undefined);const chunks:Blob[]=[];
     r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
     r.onstop=()=>{setRecording(false);stream.current?.getTracks().forEach(t=>t.stop());setFile(new File(chunks,`audio.${r.mimeType.includes('mp4')?'m4a':'webm'}`,{type:r.mimeType}));};
     recorder.current=r;r.start();setRecording(true);
   }catch(e){toast.error(e instanceof Error?e.message:'Não consegui acessar o microfone.');}
 };
 const submit=async()=>{
   if(lock.current||disabled||recording||(!text.trim()&&!file)||!navigator.onLine)return;
   lock.current=true;setBusy(true);
   try{
     const draft=text.trim();let url:string|null=null;let kind:string|undefined;
     if(file){kind=file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':'document';
       if(kind!=='image'&&file.size>getMaxSizeForType(file.type))throw new Error(`Arquivo muito grande. Limite ${getMaxSizeLabel(file.type)}.`);
       url=await uploadMediaToStorage(file);if(!url)throw new Error('Arquivo não enviado.');
     }
     setText('');setFile(null);
     await send({text:draft||(kind==='audio'?'[áudio]':`[${kind}]`),mediaUrl:url||undefined,mediaType:kind,quotedMessageId:quoted?.message_id||null});cancelQuote();
   }catch(e){toast.error(e instanceof Error?e.message:'Não consegui preparar o envio.');}finally{lock.current=false;setBusy(false);}
 };
 return <footer className="shrink-0 border-t bg-background p-2 pb-[max(8px,env(safe-area-inset-bottom))]">
  {quoted&&<div className="flex items-center gap-2 border-l-2 border-primary bg-muted p-2 text-sm"><p className="min-w-0 flex-1 truncate">↩ {quoted.message}</p><Button size="icon" variant="ghost" className="h-11 w-11" aria-label="Cancelar resposta" onClick={cancelQuote}><X/></Button></div>}
  {file&&<div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{file.name}</span><Button size="icon" variant="ghost" className="h-11 w-11" aria-label="Remover arquivo" onClick={()=>setFile(null)}><X/></Button></div>}
  <div className="flex items-end gap-2"><Textarea aria-label="Mensagem" placeholder="Mensagem" value={text} onChange={e=>setText(e.target.value)} rows={2} className="max-h-32 min-h-12 flex-1 resize-none text-base" disabled={busy}/><Button size="icon" className="h-12 w-12 shrink-0" aria-label="Enviar mensagem" disabled={disabled||busy||recording||(!text.trim()&&!file)} onClick={submit}>{busy?<Loader2 className="animate-spin"/>:<Send/>}</Button></div>
  <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
  {[[Camera,'Tirar foto',()=>camera.current?.click()],[Image,'Escolher foto',()=>image.current?.click()],[FileText,'Documento',()=>document.current?.click()],[recording?Square:Mic,recording?'Parar gravação':'Gravar áudio',record],[ShoppingBag,'Catálogo',openCatalog],[Zap,'Respostas prontas',openReplies]] .map(([Icon,label,action])=>{const I=Icon as typeof Camera;return <Button key={String(label)} variant="ghost" size="icon" className="h-11 w-11" title={String(label)} aria-label={String(label)} disabled={disabled||busy} onClick={action as ()=>void}><I className="h-5 w-5"/></Button>;})}
  {openTemplates&&<Button variant="outline" className="min-h-11" onClick={openTemplates}>Modelos API</Button>}
  </div>
  {recording&&<p role="status" className="text-sm text-destructive">Gravando…</p>}
  <input ref={image} type="file" accept="image/*" hidden onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}}/>
  <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}}/>
  <input ref={document} type="file" hidden onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}}/>
 </footer>;
}
