import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter } from '@/components/ui/dialog';
import { Trash2,MessageCircle,Instagram,Save } from 'lucide-react';
import { rhRpc,RH_STATUS } from '@/lib/rh/api';
import { toast } from 'sonner';
export function RhCandidateActions({candidate,onSaved,onDeleted}:{candidate:any;onSaved:()=>void;onDeleted:()=>void}){
 const [status,setStatus]=useState(candidate.status||'novo'),[observation,setObservation]=useState(candidate.observacao||'');
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 const phone=String(candidate.whatsapp||'').replace(/\D/g,'');
 async function save(){setBusy(true);try{await rhRpc('rh_update_candidato',{p_id:candidate.id,p_status:status,p_observacao:observation});toast.success('Status salvo');onSaved();}catch(e){toast.error(String(e));}finally{setBusy(false);}}
 async function remove(){setBusy(true);try{await rhRpc('rh_delete_candidato',{p_id:candidate.id});onDeleted();}catch(e){toast.error(String(e));}finally{setBusy(false);setConfirm(false);}}
 return <div className="space-y-3"><div className="flex flex-wrap gap-2">{phone&&<Button variant="outline" size="sm" asChild><a target="_blank" rel="noreferrer" href={`https://wa.me/${phone.length===11?'55'+phone:phone}`}><MessageCircle className="h-4 w-4 mr-2"/>Chamar no WhatsApp</a></Button>}<Button variant="outline" size="sm" asChild><a target="_blank" rel="noreferrer" href={`https://instagram.com/${candidate.instagram_username}`}><Instagram className="h-4 w-4 mr-2"/>Abrir Instagram</a></Button></div>{candidate.status&&candidate.status!=='incompleto'&&<><Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Status do candidato"><SelectValue/></SelectTrigger><SelectContent>{RH_STATUS.map(([key,label])=><SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select><Textarea aria-label="Observação" placeholder="Observação" value={observation} onChange={e=>setObservation(e.target.value)} maxLength={3000}/><Button size="sm" onClick={save} disabled={busy}><Save className="h-4 w-4 mr-2"/>Salvar status</Button></>}<Button className="ml-2" variant="destructive" size="sm" onClick={()=>setConfirm(true)}><Trash2 className="h-4 w-4 mr-2"/>Apagar candidato</Button><Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Apagar este candidato?</DialogTitle></DialogHeader><p>O cadastro, as respostas e a avaliação serão apagados definitivamente.</p><DialogFooter><Button variant="outline" onClick={()=>setConfirm(false)}>Cancelar</Button><Button variant="destructive" disabled={busy} onClick={remove}>Apagar definitivamente</Button></DialogFooter></DialogContent></Dialog></div>;
}
