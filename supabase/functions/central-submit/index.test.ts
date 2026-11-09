import { centralHandler,hashCentralToken } from '../_shared/central-handler.ts';
const item='00000000-0000-4000-8000-000000000001';const token='a'.repeat(43);const assert=(ok:boolean)=>{if(!ok)throw new Error('assertion failed');};
Deno.test('submissão simulada usa hash e RPC atômica sem provedores',async()=>{
 const calls:{name:string;args:Record<string,unknown>}[]=[];const db={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:{status:'escalado',id:item},error:null};}};
 const res=await centralHandler('submit',db,async()=>true)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'devolucao',item_id:item,quantity:1,reason:'outro',detail:'Quero devolver',unused:true})}));await res.text();assert(res.status===200);assert(calls.length===1);assert(calls[0].name==='central_submit_atomic');assert(calls[0].args.p_hash===await hashCentralToken(token));assert(calls[0].args.p_hash!==token);
});
Deno.test('devolução rejeita reposição sem consultar banco',async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return {data:null,error:null};}};const res=await centralHandler('submit',db,async()=>true)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'devolucao',item_id:item,replacement_id:item,quantity:1,reason:'outro',detail:'Devolver',unused:true})}));await res.text();assert(res.status===400);assert(calls===0);
});
Deno.test('central permanece fechada sem limite autorizado',async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return {data:null,error:null};}};const res=await centralHandler('resolve',db,async()=>false)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'troca'})}));await res.text();assert(res.status===503);assert(calls===0);
});
Deno.test('token inexistente resposta genérica',async()=>{
 const db={rpc:async()=>({data:null,error:null})};const res=await centralHandler('resolve',db,async()=>true)(new Request('http://localhost',{method:'POST',body:JSON.stringify({token,type:'troca'})}));const body=await res.json();assert(res.status===404);assert(body.error==='Este link não está disponível. Peça um novo link à equipe.');
});
