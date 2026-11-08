import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { requireAuth } from '../_shared/requireAuth.ts';
import { calculate } from './rules.ts';
import { evaluate } from './ai.ts';
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...corsHeaders,'Content-Type':'application/json'}});
// Phase 5 extension point: intentionally no message, queue or notification.
async function evaluationFinished(_id:string):Promise<void>{}
Deno.serve(withAccessLog('rh-score',async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 const denied=await requireAuth(req,[],true);if(denied)return denied;
 let body:any;try{body=await req.json();}catch{return json({message:'Pedido inválido.'},400);}
 const id=String(body.candidato_id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return json({message:'Cadastro inválido.'},400);
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');const url=Deno.env.get('SUPABASE_URL');if(!service||!url)return json({message:'Serviço indisponível.'},503);
 const internal=req.headers.get('authorization')===`Bearer ${service}`;
 // Browser cannot request automatic mode, or inject scoring inputs/failure simulation.
 const manual=!internal;
 const sb=createClient(url,service,{auth:{persistSession:false}});
 const {data:input,error}=await sb.rpc('rh_score_claim',{p_id:id,p_manual:manual});if(error)return json({message:'Não foi possível iniciar a avaliação.'},500);if(!input?.ok)return json({message:input?.message},409);
 let ai=null,err:string|null=null;
 try{if(input.settings.ai_blocked_reason)throw new Error(input.settings.ai_blocked_reason);ai=await evaluate(input);}catch(e){err=e instanceof Error?e.message:'Avaliação indisponível.';const status=(e as any).status;if(status===402||status===403)await sb.from('rh_settings').update({ai_blocked_reason:err}).eq('id',1);}
 const result=calculate(input,ai,err);
 const {data:saved,error:saveError}=await sb.rpc('rh_score_finish',{p_id:id,p_token:input.token,p_result:result});if(saveError||!saved)return json({message:'Não foi possível salvar a avaliação.'},500);
 await evaluationFinished(id);return json({ok:true,...result});
}));
