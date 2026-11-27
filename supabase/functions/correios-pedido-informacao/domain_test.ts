import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildOpenPayload, buildReactivatePayload, parseOpen, parseCheck, parseReactivate, trackingQuery, safePayload } from './domain.ts';
const input = { contrato:'1234567890',cartao:'0123456789',telefone:'(33) 99123-0581',email:'remetente@example.org',codigoObjeto:'AP000000000BR',nome:'Cliente Teste',motivo:211,tipo:'R' as const,formato:'2' };
Deno.test('monta o corpo nacional exato com motivo 211, caixa C e contato do remetente', () => {
  assertEquals(buildOpenPayload(input),{contrato:'1234567890',cartao:'0123456789',telefone:'33991230581',pedidos:[{codigoObjeto:'AP000000000BR',emailResposta:'remetente@example.org',nomeDestinatario:'Cliente Teste',codigoMotivoReclamacao:211,tipoEmbalagem:'C',tipoManifestacao:'R'}]});
});
Deno.test('envelope usa E e solicitação de ressarcimento usa I', () => { const p=buildOpenPayload({...input,formato:'1',tipo:'I'}); assertEquals(p.pedidos[0].tipoEmbalagem,'E'); assertEquals(p.pedidos[0].tipoManifestacao,'I'); });
Deno.test('e-mail do remetente vazio impede abertura sem inventar contato', () => { const error=assertThrows(()=>buildOpenPayload({...input,email:''}),Error,'configure o e-mail do remetente'); assertEquals((error as Error & {payload:ReturnType<typeof buildOpenPayload>}).payload.pedidos[0].emailResposta,''); });
Deno.test('embalagem desconhecida e motivo não permitido bloqueiam envio', () => {assertThrows(()=>buildOpenPayload({...input,formato:'3'}));assertThrows(()=>buildOpenPayload({...input,motivo:999}));});
Deno.test('resposta de abertura com chaves do manual reconhece protocolo e hora Brasília', () => {
 const result=parseOpen({codigoRetorno:0,dataHoraCadastro:'20/04/2023 16:13:15',pi:[{'codigo do objeto':'AP000000000BR','numero do pi':'123456789','codigo retorno':'0','descrição retorno':'Registrado'}]},input.codigoObjeto);
 assertEquals(result.ok,true);assertEquals(result.protocolo,'123456789');assertEquals(result.opened_at,'2023-04-20T19:13:15.000Z');
});
Deno.test('erro individual prevalece sobre sucesso global, não aceita outro objeto', () => {
 assertEquals(parseOpen({codigoRetorno:0,pi:[{'codigo do objeto':input.codigoObjeto,'numero do pi':'0','codigo retorno':'544'}]},input.codigoObjeto).ok,false);
 assertEquals(parseOpen({codigoRetorno:0,pi:[{codigoObjeto:'ZZ000000000BR',numeroPi:'123',codigoRetorno:0}]},input.codigoObjeto).ok,false);
});
Deno.test('acompanha usa nomes de parâmetros e canal W exatos do manual',()=>assertEquals(trackingQuery('123','456'),'/pedido-informacao/v1/externo/pedidos/acompanha?contrato=123&canal=W&codigodoObjetoOuProtocolo=456'));
Deno.test('parser identifica resposta fechada e data conforme manual',()=>{
 const r=parseCheck({codigoObjeto:input.codigoObjeto,numeroPi:'123','situaçãoManifestacao':'Fechado',mensagemUltimaResposta:'Resposta dos Correios',dataUltimaResposta:'07/06/2024 - 16:15:43'},input.codigoObjeto,'123','aberto');
 assertEquals(r.ok,true);if(r.ok){assertEquals(r.status,'encerrado');assertEquals(r.answered_at,'2024-06-07T19:15:43.000Z');assertEquals(r.resposta_texto,'Resposta dos Correios');}
});
Deno.test('resposta ainda aberta vira respondido; objeto ou protocolo conflitante falha fechado',()=>{
 const data={codigoObjeto:input.codigoObjeto,numeroPi:'123',situacaoManifestacao:'Aberto',mensagemUltimaResposta:'Resposta'};
 const r=parseCheck(data,input.codigoObjeto,'123','aberto');if(r.ok)assertEquals(r.status,'respondido'); else throw new Error('esperava resposta');
 assertEquals(parseCheck(data,input.codigoObjeto,'456','aberto').ok,false);
 assertEquals(parseCheck({codigoRetorno:'004',descricaoRetorno:'Não encontrado'},input.codigoObjeto,'123','aberto').ok,false);
});
Deno.test('reativa usa reativacoes, observacao e aceita somente retorno 512',()=>{
 assertEquals(buildReactivatePayload('123','456',{protocolo:'789',tipo_manifestacao:'R',motivo_codigo:211},'Ainda não chegou'),{contrato:'123',cartao:'456',reativacoes:[{protocolo:'789',tipoManifestacao:'R',motivoReativacao:'211',observacao:'Ainda não chegou'}]});
 assertEquals(parseReactivate({listaPi:[{protocolo:'0',codigoRetorno:512}]},'789').ok,true);
 assertEquals(parseReactivate({listaPi:[{protocolo:'789',codigoRetorno:591}]},'789').ok,false);
});
Deno.test('reativação em andamento não é respondida pela resposta antiga preservada nos Correios',()=>{
 const result=parseCheck({codigoObjeto:input.codigoObjeto,numeroPi:'123',situacaoManifestacao:'Em andamento',mensagemUltimaResposta:'Resposta anterior'},input.codigoObjeto,'123','reativado');
 assertEquals(result.ok,true);if(result.ok)assertEquals(result.status,'reativado');
});
Deno.test('respostas persistidas nunca carregam tokens ou autorização',()=>assertEquals(safePayload({token:'fake',Authorization:'fake',pi:[{protocolo:'123',secret:'fake'}]}),{pi:[{protocolo:'123'}]}));