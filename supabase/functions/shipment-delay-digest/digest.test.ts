import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { classifyShipment, addItem, emptyGroups, runDigest, type Shipment } from './digest.ts';

const now=new Date('2026-11-27T21:34:00Z');
const base:Shipment={id:'shipment-1',customer_name:'Beatriz da Silva Pereira',real_carrier:'PAC',real_tracking_code:'AP696380658BR',
  tracking_code:'BC-123456',real_events:[{at:'2026-11-26T15:00:00Z',description:'Objeto em transferência'}],
  real_post_base:'2026-11-16T15:00:00Z',delivery_estimate:{end:'2026-11-30'},stage_history:{enviado:'2026-11-16T15:00:00Z'},own_correios:true};

Deno.test('PROBLEMA: tentativa, retirada, retorno, cancelamento de saída e problema desconhecido',()=>{
  for(const description of ['Tentativa de entrega sem sucesso','Aguardando retirada','Devolvido ao remetente','Saída para entrega cancelada','Tipo de problema desconhecido']) {
    const result=classifyShipment({...base,real_events:[{at:'2026-11-16T15:00:00Z',description}]},now);
    assertEquals(result?.category,'problema');
    assertEquals(result?.days,11);
    assertEquals(result?.customer_name,'Beatriz Pereira');
    assertEquals(result?.own_correios,true);
  }
  assertEquals(classifyShipment({...base,real_events:[{at:'2026-11-16T15:00:00Z',description:'Objeto não entregue',type:'BDE',status:'20'}]},now)?.category,'problema');
});
Deno.test('PRAZO ESTOURADO: somente com postagem real e end antes de hoje em São Paulo',()=>{
  assertEquals(classifyShipment({...base,delivery_estimate:{end:'2026-11-26'}},now)?.category,'prazo_estourado');
  assertEquals(classifyShipment({...base,delivery_estimate:{end:'2026-11-26'}},now)?.days,1);
  assertEquals(classifyShipment({...base,delivery_estimate:{end:'2026-11-27'}},now),null);
  assertEquals(classifyShipment({...base,real_post_base:null,stage_history:null,delivery_estimate:{end:'2026-11-01'}},now),null);
  // 28/11 UTC ainda é 27/11 em Brasília: prazo de hoje não está atrasado.
  assertEquals(classifyShipment({...base,delivery_estimate:{end:'2026-11-27'}},new Date('2026-11-28T01:00:00Z')),null);
});
Deno.test('PARADO: cinco dias corridos inclusive fim de semana, exige postagem real',()=>{
  const row={...base,real_events:[{at:'2026-11-22T15:00:00Z',description:'Objeto em transferência'}]};
  assertEquals(classifyShipment(row,now)?.category,'parado');
  assertEquals(classifyShipment(row,now)?.days,5);
  assertEquals(classifyShipment({...row,real_events:[{at:'2026-11-23T15:00:00Z',description:'Objeto em transferência'}]},now),null);
  assertEquals(classifyShipment({...row,real_post_base:null,stage_history:null},now),null);
});
Deno.test('ETIQUETA SEM COLETA: três dias úteis, código real, sem postagem; EMISSAO é reserva',()=>{
  const row={...base,real_post_base:null,real_events:[{at:'2026-11-24T15:00:00Z',description:'Etiqueta emitida'}],stage_history:{enviado:'2026-11-24T15:00:00Z'}};
  assertEquals(classifyShipment(row,now)?.category,'etiqueta_sem_coleta');
  assertEquals(classifyShipment(row,now)?.days,3);
  assertEquals(classifyShipment({...row,stage_history:null,real_events:[{at:'2026-11-24T15:00:00Z',description:'EMISSAO'}]},now)?.category,'etiqueta_sem_coleta');
  assertEquals(classifyShipment({...row,real_tracking_code:null},now),null);
  assertEquals(classifyShipment({...row,stage_history:{enviado:'2026-11-25T15:00:00Z'}},now),null);
  assertEquals(classifyShipment({...row,stage_history:{enviado:'2026-11-20T15:00:00Z'}},new Date('2026-11-24T21:00:00Z')),null);
});
Deno.test('Prioridade exclusiva: problema > prazo estourado > parado > etiqueta',()=>{
  const expired={...base,delivery_estimate:{end:'2026-11-10'},real_events:[{at:'2026-11-16T15:00:00Z',description:'Objeto em transferência'}]};
  assertEquals(classifyShipment({...expired,real_events:[{at:'2026-11-16T15:00:00Z',description:'Saída para entrega cancelada'}]},now)?.category,'problema');
  assertEquals(classifyShipment(expired,now)?.category,'prazo_estourado');
  assertEquals(classifyShipment({...expired,delivery_estimate:null},now)?.category,'parado');
  assertEquals(classifyShipment({...expired,delivery_estimate:null,real_post_base:null},now)?.category,'etiqueta_sem_coleta');
});
Deno.test('Último evento é cronológico; problema antigo não vence movimentação recente',()=>{
  const row={...base,real_events:[{at:'2026-11-26T15:00:00Z',description:'Objeto em transferência'},{at:'2026-11-16T15:00:00Z',description:'Destinatário ausente'}]};
  assertEquals(classifyShipment(row,now),null);
  assertEquals(row.real_events[0].description,'Objeto em transferência');
});
Deno.test('No máximo 12 itens por categoria, pior primeiro, sem perder a contagem',()=>{
  const groups=emptyGroups();
  for(let i=0;i<15;i++) {
    const item=classifyShipment({...base,id:String(i),real_events:[{at:'2026-11-16T15:00:00Z',description:'Tipo de problema desconhecido'}]},now);
    if(!item) throw new Error('Item esperado');
    addItem(groups,{...item,days:i});
  }
  assertEquals(groups.problema.count,15);
  assertEquals(groups.problema.items.length,12);
  assertEquals(groups.problema.items[0].days,14);
  assertEquals(groups.problema.items[11].days,3);
});
Deno.test('dry_run não chama transporte, mesmo habilitado e com problemas',async()=>{
  let calls=0;
  async function* source(){yield [{...base,delivery_estimate:{end:'2026-11-26'}}];}
  const result=await runDigest({dryRun:true,enabled:true,now,shipments:source(),send:async()=>{calls++;}});
  assertEquals(calls,0);assertEquals(result.sent,false);assertEquals(result.categories.prazo_estourado.count,1);assertEquals(result.scanned,1);
});
Deno.test('Desabilitado não envia; habilitado envia uma única mensagem pelo transporte simulado',async()=>{
  let calls=0;
  async function* source(){yield [base];yield [{...base,id:'2',delivery_estimate:{end:'2026-11-26'}}];}
  await runDigest({dryRun:false,enabled:false,now,shipments:source(),send:async()=>{calls++;}});
  assertEquals(calls,0);
  const result=await runDigest({dryRun:false,enabled:true,now,shipments:source(),send:async()=>{calls++;}});
  assertEquals(calls,1);assertEquals(result.sent,true);assertEquals(result.scanned,2);
});
Deno.test('Falha na leitura não envia resumo incompleto nem repete transporte',async()=>{
  let calls=0,failed=false;
  async function* source(){yield [base];throw new Error('leitura indisponível');}
  try { await runDigest({dryRun:false,enabled:true,now,shipments:source(),send:async()=>{calls++;}}); } catch { failed=true; }
  assertEquals(failed,true);assertEquals(calls,0);
});