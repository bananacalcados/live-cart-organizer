import { centralHandler,hashCentralToken } from '../_shared/central-handler.ts';
const item='00000000-0000-4000-8000-000000000001';const token='a'.repeat(43);const assert=(ok:boolean)=>{if(!ok)throw new Error('assertion failed');};
Deno.test('submissão simulada usa hash e RPC atômica sem provedores',async()=>{
 const calls:{name:string;args:Record<string,unknown>}[]=[];const db={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:{status:'escalado',id:item},error:null};}};
 const res=await centralHandler('submit',db,async()=>true,async()=>true)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'devolucao',item_id:item,quantity:1,reason:'outro',detail:'Quero devolver',unused:true})}));await res.text();assert(res.status===200);assert(calls.length===1);assert(calls[0].name==='central_submit_atomic');assert(calls[0].args.p_hash===await hashCentralToken(token));assert(calls[0].args.p_hash!==token);
});
Deno.test('devolução rejeita reposição sem consultar banco',async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return {data:null,error:null};}};const res=await centralHandler('submit',db,async()=>true,async()=>true)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'devolucao',item_id:item,replacement_id:item,quantity:1,reason:'outro',detail:'Devolver',unused:true})}));await res.text();assert(res.status===400);assert(calls===0);
});
Deno.test('central permanece fechada sem limite autorizado',async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return {data:null,error:null};}};const res=await centralHandler('resolve',db,async()=>false)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'troca'})}));await res.text();assert(res.status===503);assert(calls===0);
});
Deno.test('token inexistente resposta genérica',async()=>{
 const db={rpc:async()=>({data:null,error:null})};const res=await centralHandler('resolve',db,async()=>true,async()=>true)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'troca'})}));const body=await res.json();assert(res.status===404);assert(body.error==='Este link não está disponível. Peça um novo link à equipe.');
});

Deno.test('link inexistente conta como falha e bloqueia após excesso',async()=>{
 const fails=new Map<string,number>();const limiter=async(keys:string[],fail:boolean)=>{if(!fail)return !keys.some(k=>(fails.get(k)||0)>=5);let ok=true;for(const k of keys){const n=(fails.get(k)||0)+1;fails.set(k,n);if(n>=5)ok=false;}return ok;};
 const db={rpc:async()=>({data:null,error:null})};const h=centralHandler('resolve',db,async()=>true,limiter);const statuses:number[]=[];
 for(let n=0;n<7;n++){const r=await h(new Request('http://localhost',{method:'POST',headers:{'x-forwarded-for':'1.2.3.4'},body:JSON.stringify({token,type:'troca'})}));await r.text();statuses.push(r.status);}
 assert(statuses.slice(0,4).every(s=>s===404));assert(statuses.slice(4).every(s=>s===429));
});
Deno.test('limitador indisponível mantém fechado',async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return {data:{ok:1},error:null};}};const r=await centralHandler('resolve',db,async()=>true,async()=>false)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'troca'})}));await r.text();assert(r.status===429);assert(calls===0);
});
Deno.test('troca repassa tamanho desejado e produto ao banco, que decide pelo interruptor',async()=>{
 const calls:any[]=[];const db={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push(args);return {data:{status:'escalado',id:item},error:null};}};
 const r=await centralHandler('submit',db,async()=>true,async()=>true)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'troca',item_id:item,replacement_id:item,quantity:1,reason:'tamanho',detail:'Ficou pequeno',unused:true,desired:'  nº 37  '})}));await r.text();
 assert(r.status===200);assert(calls[0].p_desired==='nº 37');assert(calls[0].p_replacement===item);
});
Deno.test('pedido de tamanho acima de 200 caracteres é recusado',async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return {data:null,error:null};}};const r=await centralHandler('submit',db,async()=>true,async()=>true)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'troca',item_id:item,quantity:1,reason:'tamanho',detail:'Ficou pequeno',unused:true,desired:'x'.repeat(201)})}));await r.text();assert(r.status===400);assert(calls===0);
});
