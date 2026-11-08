export const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
export function closesResponse(s: string) {
 const t=s.trim().replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D\s]+$/gu,'');
 return t.endsWith('?') || /(?:volt(?:o|amos|aremos)|retorn(?:o|amos|aremos)|vou voltar|vamos voltar).*(?:em breve|daqui a pouco|logo).*(?:deu certo|conseguiu|compra)/.test(norm(t));
}
export function aiInput(input: any) {
 return { cenarios: input.respostas.map((r: any)=>({ordem:r.ordem,contexto:r.contexto,mensagem:r.mensagem,gabarito:r.gabarito,resposta:r.resposta})), situacao:input.candidato.situacao };
}
export function calculate(input:any, ai:any=null, error:string|null=null) {
 const s=input.settings,c=input.candidato; const alerts:string[]=ai?.alertas||[];
 const scenarios=input.respostas.map((r:any,i:number)=>{
 const close=closesResponse(r.resposta)?3:0,short=[...r.resposta.trim()].length<=200?2:0;
 const right=ai?.cenarios[i]?.acao_certa?3:0,tone=ai?Math.max(0,Math.min(2,Number(ai.cenarios[i]?.tom)||0)):0;
 return {ordem:r.ordem,fechamento:close,curta:short,acao_certa:right,tom:tone,pontos:close+short+right+tone,nota:ai?.cenarios[i]?.nota||null};});
 const months=input.experiencias.map((e:any)=>Number(e.duracao_meses));
 const avg=months.length?months.reduce((a:number,b:number)=>a+b,0)/months.length:0;
 const bracket=s.faixas_permanencia.find((f:any,i:number)=>f.ate_meses===null || (i===0?avg<Number(f.ate_meses):avg<=Number(f.ate_meses)));
 const tenure=months.length?Number(bracket?.pontos||0):Number(s.pontos_sem_experiencia);
 if(months.length&&avg<3) alerts.push('Permanência média inferior a 3 meses; não elimina.');
 const matched=input.bairros.filter((b:any)=>norm(b.bairro_norm)===norm(c.bairro||''));
 const neighborhood=Math.min(Number(s.pontos_bairro_max),Math.max(0,...matched.map((b:any)=>Number(b.pontos))));
 const transport=Number(s.pontos_transporte[c.transporte]||0),combined=Math.min(Number(s.teto_transporte),transport+neighborhood);
 const computer=Number(s.pontos_computador[c.computador]||0),situation=ai?Math.max(0,Math.min(10,Number(ai.situacao_nota)||0))*2:0;
 const points={atendimento:scenarios.reduce((a:number,b:any)=>a+b.pontos,0)/30*Number(s.pesos.atendimento),situacao:situation/20*Number(s.pesos.situacao),permanencia:tenure/15*Number(s.pesos.permanencia),transporte:combined/10*Number(s.pesos.transporte),computador:computer/5*Number(s.pesos.computador)};
 return {nota:Math.round(Math.max(0,Math.min(100,Object.values(points).reduce((a,b)=>a+b,0)))*10)/10,parcial:!ai,
 detalhe:{pontos:points,cenarios:scenarios,situacao:{nota_0_10:ai?.situacao_nota??null,pontos:points.situacao},permanencia:{quantidade:months.length,media_meses:Math.round(avg*10)/10,pontos:points.permanencia,pontos_base:tenure},transporte:{meio:transport,bairro:neighborhood,bairros:matched,teto:s.teto_transporte,pontos:points.transporte},computador:{resposta:c.computador,pontos:points.computador},nao_topa:c.aceita_condicoes===false,pesos:s.pesos},resumo_ia:ai?.resumo?.slice(0,3).join('\n')||null,alertas:alerts,ai_error:error};
}
