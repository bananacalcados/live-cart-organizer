import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { isAuthorizedCron } from '../_shared/cron-guard.ts';
import { authenticateCronRequest } from '../_shared/cron-auth.ts';
import { freightAuth } from '../_shared/freight-auth.ts';
import { loadCorreiosSettings, getCorreiosToken } from '../_shared/correios.ts';
import { MOTIVOS, buildOpenPayload, buildReactivatePayload, trackingQuery, providerMessage, parseOpen, parseCheck, parseReactivate, safePayload, type PiStatus, object } from './domain.ts';

const motivo = z.number().int().refine(n => !!MOTIVOS[n], 'Motivo não permitido');
const Body = z.discriminatedUnion('action', [
  z.object({action:z.literal('check_access')}).strict(),
  z.object({action:z.literal('open'),sale_id:z.string().uuid().optional(),codigo_objeto:z.string().regex(/^[A-Z]{2}\d{9}BR$/).optional(),motivo_codigo:motivo,tipo_manifestacao:z.enum(['R','I']).default('R'),dry_run:z.boolean().default(false)}).strict(),
  z.object({action:z.literal('check'),id:z.string().uuid().optional()}).strict(),
  z.object({action:z.literal('reactivate'),id:z.string().uuid(),texto:z.string().trim().min(3).max(4000)}).strict(),
  z.object({action:z.literal('list'),sale_id:z.string().uuid().optional(),limit:z.number().int().min(1).max(50).default(50),offset:z.number().int().min(0).max(100000).default(0)}).strict(),
]);
const COLS='id,sale_id,shipment_id,codigo_objeto,motivo_codigo,motivo_descricao,tipo_manifestacao,status,protocolo,resposta_texto,opened_at,last_checked_at,answered_at,opened_by,error_message';
const fail = (message:string,status=400) => Object.assign(new Error(message),{status});
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});

Deno.serve(withAccessLog('correios-pedido-informacao', async req => {
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST') return reply({error:'Use POST'},405);
  try {
    const parsed=Body.safeParse(await req.json().catch(()=>null));
    if(!parsed.success) return reply({error:'Requisição inválida',details:parsed.error.flatten()},400);
    const b=parsed.data;
    const cron=await isAuthorizedCron(req) || authenticateCronRequest(req)===null;
    const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!key) throw fail('Configuração interna indisponível',500);
    const auth=cron ? {db:createClient(url,key,{auth:{persistSession:false}}),userClient:null,userId:null} : await freightAuth(req,false);
    const {db,userClient,userId}=auth;
    if(!cron){
      const team=await db.rpc('is_team_member',{_uid:userId});
      if(team.error||team.data!==true) throw fail('Acesso exclusivo da equipe',403);
    }
    const visibleSale=async(saleId:string)=>{
      if(!userClient) return;
      const s=await userClient.from('pos_sales').select('id').eq('id',saleId).maybeSingle();
      if(s.error||!s.data) throw fail('Sem acesso à venda',403);
    };
    const ownShipment=async(saleId?:string,code?:string)=>{
      let q=db.from('correios_shipments').select('id,sale_id,sale_ids,codigo_objeto,status,request').not('status','in','(cancelada,erro)');
      if(saleId)q=q.contains('sale_ids',[saleId]);
      if(code)q=q.eq('codigo_objeto',code);
      const r=await q.order('created_at',{ascending:false}).limit(2);
      if(r.error)throw fail('Não foi possível consultar o envio Correios',500);
      if(!r.data?.length)throw fail('Objeto não encontrado no contrato próprio dos Correios',404);
      if(r.data.length!==1)throw fail('Há mais de um envio; informe o objeto exato');
      return r.data[0];
    };

    if(b.action==='list'){
      let own:null|{codigo_objeto:string|null}=null;
      if(b.sale_id){
        await visibleSale(b.sale_id);
        try{own=await ownShipment(b.sale_id);}catch(e){if((e as {status?:number}).status===404)return reply({requests:[],own_object:null,has_more:false});throw e;}
      }
      let q=db.from('correios_pi_requests').select(`${COLS},pos_sales(customer_name)`);
      if(b.sale_id&&own?.codigo_objeto)q=q.eq('codigo_objeto',own.codigo_objeto);
      else if(b.sale_id)return reply({requests:[],own_object:null,has_more:false});
      const r=await q.order('opened_at',{ascending:false}).order('id',{ascending:false}).range(b.offset,b.offset+b.limit);
      if(r.error)throw fail('Não foi possível listar os chamados',500);
      return reply({requests:(r.data||[]).slice(0,b.limit),has_more:(r.data?.length||0)>b.limit,own_object:own?.codigo_objeto||null});
    }

    let rows:any[]=[];
    if(b.action==='check'||b.action==='reactivate'){
      let q=db.from('correios_pi_requests').select(COLS);
      if(b.id)q=q.eq('id',b.id);
      else q=q.in('status',['aberto','reativado']);
      const r=await q.order('last_checked_at',{ascending:true,nullsFirst:true}).order('id').limit(b.id?1:50);
      if(r.error)throw fail('Não foi possível ler os chamados',500);
      rows=r.data||[];
      if(b.id&&!rows.length)throw fail('Chamado não encontrado',404);
      if(b.id)await visibleSale(rows[0].sale_id);
      if(b.action==='check'&&!rows.length)return reply({checked:0,results:[]});
    }
    const settings=await loadCorreiosSettings(db);
    if(!settings.contrato||!settings.cartao_postagem)throw fail('Configure contrato e cartão dos Correios');
    // Cache/token remains shared with correios-shipment; never return or log credentials.
    let token:string|null=null;
    const call=async(path:string,payload?:unknown)=>{
      if(!token)token=(await getCorreiosToken(db,{settings})).token;
      const base=settings.ambiente==='homologacao'?'https://apihom.correios.com.br':'https://api.correios.com.br';
      const r=await fetch(`${base}${path}`,{method:payload?'POST':'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(12000)});
      const raw=await r.text();
      let data:unknown;try{data=JSON.parse(raw);}catch{data={mensagem:raw.slice(0,2000)};}
      return {http_status:r.status,ok:r.ok,response:safePayload(data),message:providerMessage(data)};
    };
    if(b.action==='check_access'){
      const r=await call(trackingQuery(settings.contrato,'000000000'));
      // A business-level 'not found' means the harmless GET reached the API, not that a PI exists.
      return reply({...r,api_available:r.ok});
    }
    if(b.action==='open'){
      if(!b.sale_id&&!b.codigo_objeto)throw fail('Informe venda ou código do objeto');
      const shipment=await ownShipment(b.sale_id,b.codigo_objeto);
      const saleId=b.sale_id||shipment.sale_id;
      await visibleSale(saleId);
      const s=await db.from('pos_sales').select('id,customer_name,status_cancelamento').eq('id',saleId).single();
      if(s.error||!s.data)throw fail('Venda não encontrada',404);
      if(s.data.status_cancelamento==='cancelado')throw fail('Venda cancelada não permite abrir chamado');
      const code=shipment.codigo_objeto;
      if(!code)throw fail('Envio ainda não possui código de objeto');
      let payload:ReturnType<typeof buildOpenPayload>;
      try{
        payload=buildOpenPayload({contrato:settings.contrato,cartao:settings.cartao_postagem,telefone:settings.remetente.telefone,email:settings.remetente.email||'',codigoObjeto:code,nome:s.data.customer_name||'',motivo:b.motivo_codigo,tipo:b.tipo_manifestacao,formato:String(object(shipment.request).codigoFormatoObjetoInformado||'')});
      }catch(e){return reply({dry_run:b.dry_run,valid:false,error:e instanceof Error?e.message:'Dados inválidos para abertura',payload:(e as {payload?:unknown}).payload||null},400);}
      if(b.dry_run)return reply({dry_run:true,payload,sale_id:saleId,codigo_objeto:code});
      const sim=await db.from('shipment_simulations').select('id').eq('sale_id',saleId).eq('real_tracking_code',code).maybeSingle();
      if(sim.error)throw fail('Não foi possível vincular o acompanhamento do envio',500);
      // NÃO REMOVER: reserve before provider call; uncertain sends stay active and cannot be reopened.
      const reserved=await db.from('correios_pi_requests').insert({sale_id:saleId,shipment_id:sim.data?.id||null,codigo_objeto:code,motivo_codigo:b.motivo_codigo,motivo_descricao:MOTIVOS[b.motivo_codigo],tipo_manifestacao:b.tipo_manifestacao,request_payload:payload,opened_by:userId,status:'aberto',error_message:'Abertura em andamento; consultar antes de tentar novamente'}).select(COLS).single();
      if(reserved.error){
        if(reserved.error.code==='23505'){
          const existing=await db.from('correios_pi_requests').select(COLS).eq('codigo_objeto',code).in('status',['aberto','respondido','reativado']).limit(1).maybeSingle();
          return reply({existing:true,request:existing.data,message:'Já existe chamado ativo para este objeto. Nenhuma nova abertura enviada.'},409);
        }
        throw fail('Não foi possível reservar o chamado; nada enviado',500);
      }
      const row=reserved.data;
      try{
        const r=await call('/pedido-informacao/v1/externo/pedidos/cadastra',payload),result=parseOpen(r.response,code);
        const definiteError=(!r.ok&&r.http_status<500)||(!!result.code&&!/^0+$/.test(result.code));
        const patch={status:r.ok&&result.ok?'aberto':definiteError?'erro':'aberto',protocolo:result.ok?result.protocolo:null,response_open:r.response,error_message:r.ok&&result.ok?null:result.message||r.message||'Resposta incerta; consulte antes de tentar novamente',...(result.opened_at&&result.ok?{opened_at:result.opened_at}:{})};
        const saved=await db.from('correios_pi_requests').update(patch).eq('id',row.id).select(COLS).single();
        if(saved.error)throw fail('Correios respondeu, mas não foi possível salvar; não reabra. Consulte o chamado.',500);
        return reply({...r,ok:r.ok&&result.ok,request:saved.data});
      }catch(e){
        await db.from('correios_pi_requests').update({error_message:'Resultado de abertura incerto; consulte o chamado. Não repetir automaticamente.'}).eq('id',row.id).is('protocolo',null).eq('status','aberto');
        return reply({ok:false,request_id:row.id,error:e instanceof Error?e.message:'Falha de comunicação',uncertain:true},502);
      }
    }
    if(b.action==='reactivate'){
      const row=rows[0];
      if(!row.protocolo||!['respondido','encerrado'].includes(row.status))throw fail('Consulte a resposta primeiro; só chamados respondidos podem ser reativados');
      const payload=buildReactivatePayload(settings.contrato,settings.cartao_postagem,row,b.texto);
      const reserved=await db.from('correios_pi_requests').update({status:'reativado',error_message:'Reativação em andamento; não repetir'}).eq('id',row.id).eq('status',row.status).select('id');
      if(reserved.error||!reserved.data?.length)throw fail('Chamado mudou ou já está em reativação',409);
      try{
        const r=await call('/pedido-informacao/v1/externo/pedidos/reativa',payload),result=parseReactivate(r.response,row.protocolo);
        const success=r.ok&&result.ok;
        const definiteError=(!r.ok&&r.http_status<500)||(r.ok&&Array.isArray(object(r.response).listaPi));
        const patch={status:success?'reativado':definiteError?row.status:'reativado',last_status_payload:{reactivation_request:payload,response:r.response},error_message:success?null:result.message||r.message||'Reativação incerta; consultar antes de repetir'};
        const saved=await db.from('correios_pi_requests').update(patch).eq('id',row.id).eq('status','reativado').select(COLS).single();
        if(saved.error)throw fail('Não foi possível salvar o resultado; consulte antes de repetir',500);
        return reply({...r,ok:success,request:saved.data});
      }catch(e){return reply({ok:false,uncertain:true,request_id:row.id,error:e instanceof Error?e.message:'Reativação incerta; consulte antes de repetir'},502);}
    }
    if(b.action==='check'){
      // At most 50 external reads, eight in parallel; a single guarded DB write batch.
      token=(await getCorreiosToken(db,{settings})).token;
      const results:any[]=[],patches:any[]=[];
      for(let i=0;i<rows.length;i+=8){
        await Promise.all(rows.slice(i,i+8).map(async row=>{
          try{
            const r=await call(trackingQuery(settings.contrato||'',row.protocolo||row.codigo_objeto));
            const p=parseCheck(r.response,row.codigo_objeto,row.protocolo,row.status as PiStatus);
            const ok=r.ok&&p.ok;
            patches.push({id:row.id,expected_status:row.status,expected_checked_at:row.last_checked_at,status:ok&&p.ok?p.status:row.status,protocolo:ok&&p.ok?p.protocolo:row.protocolo,last_status_payload:r.response,resposta_texto:ok&&p.ok?p.resposta_texto:null,answered_at:ok&&p.ok?p.answered_at:null,last_checked_at:new Date().toISOString(),error_message:ok?null:p.message||r.message||'Não foi possível consultar'});
            results.push({id:row.id,...r,ok});
          }catch(e){
            const message=e instanceof Error?e.message:'Consulta indisponível';
            patches.push({id:row.id,expected_status:row.status,expected_checked_at:row.last_checked_at,status:row.status,protocolo:row.protocolo,last_status_payload:null,last_checked_at:new Date().toISOString(),error_message:message});
            results.push({id:row.id,ok:false,error:message});
          }
        }));
        if(results.some(r=>r.http_status===401||r.http_status===403))break; // Never insist when access is denied.
      }
      const saved=await db.rpc('correios_pi_apply_checks',{p_updates:patches});
      if(saved.error)throw fail('Não foi possível salvar as consultas dos chamados',500);
      return reply({checked:results.length,updated:saved.data,results});
    }
    return reply({error:'Ação inválida'},400);
  }catch(e){return reply({error:e instanceof Error?e.message:'Falha no chamado Correios'},(e as {status?:number}).status||500);}
}));