import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {refundApi,REFUND_REASONS,type RefundSource} from '@/lib/refunds';
import {parseBrlAmount} from '@/lib/refundRules';
import {useIsAdmin} from '@/hooks/useIsAdmin';
import {RefundReceiptButton} from './RefundReceiptButton';
import {SendRefundReceiptButton} from './SendRefundReceiptButton';
import {Loader2} from 'lucide-react';

export function ManualRefundDialog({source,sourceId,gateway,maxAmount,onDone}: {source:RefundSource;sourceId:string;gateway:string;maxAmount:number;onDone?:()=>void}) {
 const {isAdmin}=useIsAdmin();
 const [open,setOpen]=useState(false),[amount,setAmount]=useState(maxAmount.toFixed(2).replace('.',',')),[date,setDate]=useState(''),[reference,setReference]=useState(''),[reason,setReason]=useState('cancelamento_antes_envio'),[note,setNote]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState<string|null>(null);
 if(!isAdmin) return null;
 const submit=async()=>{
  const value=parseBrlAmount(amount),when=Date.parse(`${date}:00-03:00`);
  if(!Number.isFinite(value)||value<=0||value>maxAmount){setError('O valor deve ser positivo e não pode superar o valor disponível.');return;}
  if(!Number.isFinite(when)||when>Date.now()){setError('Informe a data da devolução em horário de Brasília, sem data futura.');return;}
  setBusy(true);setError('');
  try{const res=await refundApi.registerManual({source,source_id:sourceId,gateway:gateway.toLowerCase().replace('mercado pago','mercadopago').replace('pagar.me','pagarme'),amount:value,reason,manual_reference:reference.trim(),manual_done_at:new Date(when).toISOString(),note,password});setPassword('');setDone(res.refund_id);onDone?.();}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível registrar.');}finally{setBusy(false);}
 };
 return <><Button variant="outline" size="sm" onClick={()=>{setOpen(true);setError('');setDone(null);setPassword('');}}>Registrar estorno feito no painel</Button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Registrar estorno feito no painel · {gateway}</DialogTitle></DialogHeader>
 {done?<div className="space-y-3"><p>Devolução registrada manualmente. Nenhum dinheiro foi movimentado pelo sistema.</p><div className="flex flex-wrap gap-2"><RefundReceiptButton refundId={done}/><SendRefundReceiptButton refundId={done}/></div></div>:<div className="space-y-3">
 <p className="text-sm text-muted-foreground">Registre somente depois de concluir a devolução no painel da operadora.</p>
 <label className="block text-sm">Valor devolvido<Input aria-label="Valor devolvido" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
 <label className="block text-sm">Data e hora da devolução (Brasília)<Input aria-label="Data e hora da devolução" type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></label>
 <label className="block text-sm">Protocolo ou ID do estorno<Input aria-label="Protocolo ou ID do estorno" value={reference} maxLength={80} onChange={e=>setReference(e.target.value)}/></label>
 <label className="block text-sm">Motivo<select className="w-full rounded-md border border-input bg-background p-2" value={reason} onChange={e=>setReason(e.target.value)}>{REFUND_REASONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
 <label className="block text-sm">Observação<Textarea value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></label>
 <label className="block text-sm">Sua senha do sistema<Input aria-label="Sua senha do sistema" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
 {error&&<p className="text-sm text-destructive">{error}</p>}
 <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setOpen(false)}>Cancelar</Button><Button disabled={busy||!password||reference.trim().length<4} onClick={()=>void submit()}>{busy&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Confirmar registro manual</Button></div>
 </div>}</DialogContent></Dialog></>;
}