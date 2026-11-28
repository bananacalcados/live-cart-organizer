import { useEffect,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link,useNavigate } from 'react-router-dom';
import { Loader2,Copy,Send,User,Package,Coins,Truck,ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { EditCustomerDialog } from '@/components/pos/EditCustomerDialog';
import { CustomerOrderActions } from '@/components/pos/CustomerOrderActions';
import { POSCashbackPanel } from '@/components/pos/POSCashbackPanel';
import { RefundDialog } from '@/components/refunds/RefundDialog';
import { RefundDecisionButtons } from '@/components/refunds/RefundDecisionButtons';
import { refundApi,type RefundListRow } from '@/lib/refunds';
import { useCanRefund } from '@/hooks/useCanRefund';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { getSalePaymentState } from '@/lib/salePaymentState';
import { getShipmentTracking,publicTrackingUrl } from '@/lib/shipmentTracking';
import type { ExchangeRecord } from '@/hooks/useExchangeRegistry';
import type { PosSendProvider } from '@/lib/pos/posWhatsappSend';
import type { MobileConversation } from '@/lib/chat/mobileWhatsappReads';
import type { AttemptPayload } from '@/lib/chat/mobileSendAttempt';
import { toast } from 'sonner';
const brl=(v:number|null)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const SALE_COLUMNS='id,created_at,status,paid_at,total,payment_link,payment_gateway,source_order_id,external_order_id,sale_type,customer_name,customer_phone,customer_cpf,customer_email,customer_unified_id,mercadopago_payment_id,expedition_stage,shipped_at';
export function MobileWhatsappCustomer({target,sellerId,sellerName,provider,send,action='cliente',saleId}:{target:MobileConversation;sellerId:string|null;sellerName:string|null;provider:PosSendProvider;send:(p:AttemptPayload)=>Promise<boolean>;action?:string;saleId?:string}){
 const navigate=useNavigate();const [offset,setOffset]=useState(0);const [edit,setEdit]=useState(false);
 const canRefund=useCanRefund();const {isAdmin}=useIsAdmin();
 const customer=useQuery({queryKey:['m-wa-customer',target.phone],queryFn:async()=>{
  const {data,error}=await supabase.from('customers_unified').select('id,name,phone_e164,cpf,email,address,address_number,complement,neighborhood,city,state,cep').eq('phone_suffix8',target.phone.slice(-8)).is('merged_into_id',null).limit(2);
  if(error)throw error;return data?.length===1?data[0]:null;
 }});
 const sales=useQuery({queryKey:['m-wa-sales',target.phone,offset],enabled:action!=='ficha',queryFn:async()=>{
  const {data,error}=await supabase.from('pos_sales').select(SALE_COLUMNS).eq('phone_suffix8',target.phone.slice(-8)).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+49);
  if(error)throw error;return data||[];
 }});
 const sale=useQuery({queryKey:['m-wa-sale',saleId],enabled:!!saleId,queryFn:async()=>{
  const {data,error}=await supabase.from('pos_sales').select(`${SALE_COLUMNS},pos_sale_items(id,product_name,variant_name,size,quantity,unit_price)`).eq('id',saleId||'').eq('phone_suffix8',target.phone.slice(-8)).maybeSingle();
  if(error)throw error;return data;
 }});
 const exchanges=useQuery({queryKey:['m-wa-exchanges',saleId],enabled:!!saleId,queryFn:async()=>{
  const {data,error}=await supabase.from('trocas_devolucoes').select('id,codigo_devolucao,tipo,motivo,status,created_at,pedido_original_id').eq('pedido_original_id',saleId||'').order('created_at',{ascending:false}).limit(50);
  if(error)throw error;return (data||[]).map(e=>({...e,customer_name:target.customer_name,customer_phone:target.phone,customer_cpf:customer.data?.cpf||null,customer_unified_id:customer.data?.id||null})) as ExchangeRecord[];
 }});
 const items=sale.data?.pos_sale_items||[];
 const refresh=()=>{void sales.refetch();void sale.refetch();void exchanges.refetch();};
 const data=customer.data;const base=`/m/pdv/whatsapp/${encodeURIComponent(target.phone)}/${target.whatsapp_number_id||'none'}`;
 if(action==='ficha')return <div className="space-y-4"><h2 className="text-lg font-bold">Ficha da cliente</h2>{customer.isLoading?<Loader2 className="animate-spin"/>:data?<><dl className="space-y-3 break-words">{[['Nome',data.name],['Telefone',data.phone_e164],['CPF',data.cpf],['E-mail',data.email],['Endereço',[data.address,data.address_number,data.complement,data.neighborhood,data.city,data.state,data.cep].filter(Boolean).join(', ')]].map(([label,value])=><div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd>{value||'—'}</dd></div>)}</dl><Button className="h-12 w-full" onClick={()=>setEdit(true)}>Editar ficha</Button><EditCustomerDialog open={edit} onOpenChange={setEdit} unifiedId={data.id} onSaved={()=>void customer.refetch()}/></>:<p role="status">Não foi encontrado um cadastro único para este telefone. A ficha completa precisa de identificação da cliente.</p>}</div>;
 if(action==='cashback')return <div className="space-y-4"><h2 className="text-lg font-bold">Cashback</h2><POSCashbackPanel phone={target.phone} sales={(sales.data||[]).filter(s=>getSalePaymentState(s)==='unpaid').map(s=>({id:s.id,label:s.external_order_id||s.id.slice(0,8),total:Number(s.total),createdAt:s.created_at}))} onChanged={refresh}/></div>;
 if(action==='estornos')return <MobileCustomerRefunds phone={target.phone} canRefund={canRefund} isAdmin={isAdmin}/>;
 if(saleId)return <div className="space-y-4">{sale.isLoading?<Loader2 className="animate-spin"/>:sale.data?<>
  <h2 className="text-lg font-bold">Pedido {sale.data.external_order_id||sale.data.id.slice(0,8)}</h2><p>{brl(sale.data.total)} · {getSalePaymentState(sale.data)==='unpaid'?'Não pago':'Pago'}</p>
  <ul className="divide-y">{items.map(i=><li key={i.id} className="py-3"><strong>{i.product_name}</strong><p className="text-sm">{i.variant_name} · {i.size} · {i.quantity} par(es)</p></li>)}</ul>
  {sale.data.payment_link&&<div className="space-y-2"><Button asChild variant="outline" className="h-12 w-full"><a href={sale.data.payment_link} target="_blank" rel="noopener noreferrer">Ver link de pagamento</a></Button><div className="flex gap-2"><Button variant="outline" className="h-12 flex-1" onClick={()=>void navigator.clipboard.writeText(sale.data?.payment_link||'').then(()=>toast.success('Link copiado'))}><Copy className="mr-2 h-4 w-4"/>Copiar</Button><Button className="h-12 flex-1" onClick={()=>void send({text:sale.data?.payment_link||''})}><Send className="mr-2 h-4 w-4"/>Reenviar link</Button></div></div>}
  <MobileSaleTracking saleId={saleId} send={send}/>
  {getSalePaymentState(sale.data)==='paid'&&<CustomerOrderActions saleId={saleId} saleLabel={sale.data.external_order_id||saleId.slice(0,8)} saleTotal={sale.data.total} hasMpPayment={!!sale.data.mercadopago_payment_id} sellerId={sellerId} sellerName={sellerName} customer={{name:data?.name||target.customer_name,phone:target.phone,cpf:data?.cpf,email:data?.email,unifiedId:data?.id}} exchanges={exchanges.data||[]} chargebacks={[]} onChanged={refresh} sendVia={provider} selectedNumberId={target.whatsapp_number_id}/>}
  {canRefund&&sale.data.payment_gateway&&!sale.data.mercadopago_payment_id&&<RefundDialog source="pos_sale" sourceId={saleId} label={sale.data.external_order_id||saleId.slice(0,8)} customerName={target.customer_name} onDone={refresh}/>}
 </>:<p role="alert">Pedido não encontrado nesta conversa.</p>}</div>;
 if(action==='pedidos')return <div className="space-y-3"><h2 className="text-lg font-bold">Pedidos e compras</h2>{sales.isLoading&&<Loader2 className="animate-spin"/>}{sales.isError&&<p role="alert">Não consegui carregar os pedidos.</p>}{(sales.data||[]).map(s=><Button asChild key={s.id} variant="outline" className="h-auto min-h-20 w-full justify-between p-3 text-left"><Link to={`${base}/pedidos/${s.id}`}><span><strong className="block">{s.external_order_id||s.id.slice(0,8)}</strong><span className="block text-sm">{new Date(s.created_at).toLocaleDateString('pt-BR')} · {brl(s.total)} · {getSalePaymentState(s)==='unpaid'?'Não pago':'Pago'}</span></span><ArrowRight className="h-5 w-5 shrink-0"/></Link></Button>)}{sales.data?.length===50&&<Button variant="outline" className="h-12 w-full" onClick={()=>setOffset(o=>o+50)}>Próxima página</Button>}{offset>0&&<Button variant="outline" className="h-12 w-full" onClick={()=>setOffset(o=>Math.max(0,o-50))}>Página anterior</Button>}<MobileLiveOrders phone={target.phone} send={send}/></div>;
 return <div className="space-y-3">{[['ficha','Ficha',User],['pedidos','Pedidos, compras, troca e rastreio',Package],['cashback','Cashback',Coins],...(canRefund?[['estornos','Estornos',Truck]]:[])].map(([id,label,Icon])=>{const I=Icon as typeof User;return <Button key={String(id)} variant="outline" className="h-14 w-full justify-start gap-3" onClick={()=>navigate(`${base}/${id}`)}><I className="h-5 w-5"/>{String(label)}</Button>;})}</div>;
}
function MobileSaleTracking({saleId,send}:{saleId:string;send:(p:AttemptPayload)=>Promise<boolean>}){
 const info=useQuery({queryKey:['m-wa-tracking',saleId],queryFn:()=>getShipmentTracking(saleId)});
 if(!info.data)return null;const url=publicTrackingUrl(info.data.trackingCode);
 return <div className="space-y-2"><Button asChild variant="outline" className="h-12 w-full"><a href={url} target="_blank" rel="noopener noreferrer">Acompanhar pedido</a></Button><Button variant="outline" className="h-12 w-full" onClick={()=>void send({text:`Acompanhe o preparo e o envio do seu pedido por aqui:\n\n${url}`})}>Enviar acompanhamento</Button></div>;
}
function MobileLiveOrders({phone,send}:{phone:string;send:(p:AttemptPayload)=>Promise<boolean>}){
 const [offset,setOffset]=useState(0);
 const orders=useQuery({queryKey:['m-wa-live-orders',phone,offset],queryFn:async()=>{
  const {data:customers,error:cerror}=await supabase.from('customers').select('id').ilike('whatsapp',`%${phone.slice(-8)}%`).limit(10);if(cerror)throw cerror;
  if(!customers?.length)return [];
  const {data,error}=await supabase.from('orders').select('id,cart_link,stage,is_paid,created_at,pos_sale_id').in('customer_id',customers.map(c=>c.id)).is('pos_sale_id',null).order('created_at',{ascending:false}).range(offset,offset+49);
  if(error)throw error;return data||[];
 }});
 return <section className="space-y-3"><h3 className="font-bold">Pedidos da live</h3>{orders.isLoading&&<Loader2 className="animate-spin"/>}{orders.isError&&<p role="alert">Não consegui carregar os pedidos da live.</p>}{orders.data?.map(o=><div key={o.id} className="space-y-2 border-b py-3"><p>Live {o.id.slice(0,8)} · {o.is_paid?'Pago':o.stage}</p>{o.cart_link&&<><Button asChild variant="outline" className="h-12 w-full"><a href={o.cart_link} target="_blank" rel="noopener noreferrer">Ver carrinho</a></Button><div className="flex gap-2"><Button variant="outline" className="h-12 flex-1" onClick={()=>void navigator.clipboard.writeText(o.cart_link||'')}>Copiar</Button><Button className="h-12 flex-1" onClick={()=>void send({text:o.cart_link||''})}>Reenviar</Button></div></>}</div>)}{orders.data?.length===50&&<Button variant="outline" className="h-12 w-full" onClick={()=>setOffset(o=>o+50)}>Mais pedidos da live</Button>}</section>;
}
function MobileCustomerRefunds({phone,canRefund,isAdmin}:{phone:string;canRefund:boolean;isAdmin:boolean}){
 const [rows,setRows]=useState<RefundListRow[]>([]);const [error,setError]=useState('');const [page,setPage]=useState(0);const [more,setMore]=useState(false);
 const load=()=>refundApi.listScope({scope:'pending',search:phone,page,limit:50}).then(r=>{setRows(r.rows);setMore(r.hasMore);}).catch(e=>setError(e instanceof Error?e.message:'Consulta indisponível'));
 useEffect(()=>{if(canRefund)void load();},[phone,page,canRefund]);
 if(!canRefund)return <p>Sem permissão para estornos.</p>;
 return <div className="space-y-4"><h2 className="text-lg font-bold">Solicitações de estorno</h2>{error&&<p role="alert">{error}</p>}{rows.map(r=><div key={r.id} className="space-y-3 border-b py-3"><p>{r.customer_name} · {brl(r.amount)} · {r.status}</p>{isAdmin&&<RefundDecisionButtons refundId={r.id} row={r} onDone={()=>void load()}/>}</div>)}{!rows.length&&!error&&<p>Nenhuma solicitação pendente.</p>}{more&&<Button variant="outline" className="h-12 w-full" onClick={()=>setPage(p=>p+1)}>Próxima página</Button>}</div>;
}
