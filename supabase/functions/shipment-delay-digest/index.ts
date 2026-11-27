import { createClient, FunctionsHttpError } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { isAuthorizedCron } from '../_shared/cron-guard.ts';
import { authenticateCronRequest } from '../_shared/cron-auth.ts';
import { internalCallHeaders } from '../_shared/requireAuth.ts';
import { runDigest, type Shipment } from './digest.ts';

const Body = z.object({ dry_run:z.boolean().default(false) }).strict();
const Config = z.object({ phone:z.string().regex(/^55\d{11}$/), enabled:z.boolean() });
const response = (data:unknown,status=200) => new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});

Deno.serve(withAccessLog('shipment-delay-digest', async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders});
  // Cron legado continua válido para dry_run via pg_net; agenda gerenciada aceita só seu bearer protegido.
  if (!(await isAuthorizedCron(req))) {
    const denied = authenticateCronRequest(req);
    if (denied) return response({error:'Unauthorized'},denied.status);
  }
  if (req.method !== 'POST') return response({error:'Use POST'},405);
  let input:unknown;
  try { input=await req.json(); } catch { return response({error:'JSON inválido'},400); }
  const body = Body.safeParse(input);
  if (!body.success) return response({error:body.error.flatten()},400);
  try {
    const url=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Configuração interna indisponível');
    const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const setting=await sb.from('app_settings').select('value').eq('key','shipment_delay_digest').single();
    if (setting.error) throw new Error(setting.error.message);
    const config=Config.parse(setting.data.value);
    if (!body.data.dry_run && !config.enabled) return response({sent:false,reason:'disabled'});
    const now=new Date(), started=Date.now();
    let queries=1;
    async function* shipments():AsyncGenerator<Shipment[]> {
      for (let offset=0; offset<20000; offset+=200) {
        if (Date.now()-started > 100000) throw new Error('Resumo excedeu tempo seguro; nenhum envio realizado');
        const {data,error}=await sb.rpc('shipment_delay_digest_page',{p_limit:200,p_offset:offset});
        queries++;
        if (error) throw new Error(error.message);
        const rows=(data ?? []) as Shipment[];
        yield rows;
        if (rows.length < 200) return;
      }
      throw new Error('Limite de lotes atingido; resumo incompleto não enviado');
    }
    const result=await runDigest({dryRun:body.data.dry_run,enabled:config.enabled,now,shipments:shipments(),
      send:async text => {
        // Mesma função dos avisos internos de pagamentos: Whats Pérola / uazapi, uma chamada, sem repetição.
        const {data,error}=await sb.functions.invoke('blocked-buyer-sale-alert',{
          body:{adminPhone:config.phone,message:text},headers:await internalCallHeaders(),
        });
        if (error) {
          const detail=error instanceof FunctionsHttpError ? await error.context.text() : error.message;
          throw new Error(`Falha no aviso interno: ${detail}`);
        }
        if (data?.success !== true) throw new Error('Aviso interno não confirmou envio');
      },
    });
    return response({...result,phone:config.phone,enabled:config.enabled,transport:'blocked-buyer-sale-alert',
      instance:'Whats Pérola',provider:'uazapi',queries,duration_ms:Date.now()-started});
  } catch (error) {
    console.error('shipment-delay-digest:',error instanceof Error ? error.message : 'erro desconhecido');
    return response({error:error instanceof z.ZodError ? 'Configuração de destino inválida' : error instanceof Error ? error.message : 'Falha no resumo'},500);
  }
}));