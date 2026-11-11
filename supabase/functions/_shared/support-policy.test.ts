import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cpfAttemptAllowed, cpfIdentityConfirmed, humanOtherInstances, maskCpf, preferredLink, unifyMessages, validCpf } from "./support-policy.ts";
import { runAgent, finalDecision, type AgentDeps, type Triage } from "./support-ai.ts";
Deno.test("histórico de todos os números em ordem, sem duplicar", () => {
  const a = { from: "cliente" as const, text: "trocar", at: "2026-11-11T12:00:00Z", instance_id: "A" };
  const b = { ...a, at: "2026-11-11T11:00:00Z", instance_id: "B" };
  assertEquals(unifyMessages([a,b,a]).map(m=>m.instance_id), ["B","A"]);
});
Deno.test("consolidação exige humano em outra instância dentro de 72h", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const m = { from: "loja" as const, text: "atendimento", at: "2026-11-08T12:00:00Z", instance_id: "B", human: true };
  assertEquals(humanOtherInstances([m],"A",now),["B"]);
  assertEquals(humanOtherInstances([m],"A",now+1),[]);
  assertEquals(humanOtherInstances([{...m,human:false}],"A",now),[]);
});
Deno.test("não original preserva tipo pedido e manda direto", () => { assertEquals(preferredLink("devolucao",{originality:true},0),"devolucao"); assertEquals(preferredLink("troca",{originality:true},0),"troca"); });
Deno.test("oferta única de troca; insistência devolve", () => { assertEquals(preferredLink("devolucao",{},0),"troca"); assertEquals(preferredLink("devolucao",{},1),"devolucao"); assertEquals(preferredLink("devolucao",{insisted_return:true},0),"devolucao"); });
Deno.test("CPF valida dois dígitos e recusa repetidos",()=>{assertEquals(validCpf("529.982.247-25"),true); assertEquals(validCpf("52998224724"),false);assertEquals(validCpf("11111111111"),false);});
Deno.test("CPF máscara deixa só final",()=>assertEquals(maskCpf("529.982.247-25"),"***.***.***-25"));
Deno.test("CPF no máximo duas tentativas por dia",()=>{assertEquals(cpfAttemptAllowed(1),true); assertEquals(cpfAttemptAllowed(2),false);});
Deno.test("CPF sem nome coincidente exige confirmação exata do produto",()=>{assertEquals(cpfIdentityConfirmed("Ana","Maria","Tênis Azul",null),false); assertEquals(cpfIdentityConfirmed("Ana","Maria","Tênis Azul","Tênis Azul"),true); assertEquals(cpfIdentityConfirmed("Ana","Ana Paula","Tênis Azul",null),true);});
const triage: Triage={categoria:"devolucao",confianca:1,justificativa:"devolver",motivo_tamanho:false,facts:{originality:true}};
const deps: AgentDeps={orders:[{ref:"P1",data:"2026-11-01",canal:"online",status:"paid",entregue_em:"2026-11-10",itens:[]}],offersAlreadyMade:0,maxOffers:1,checkEligibility:async()=>({elegivel:"eligible",motivo:"dentro_do_prazo",prazo_ate:null}),sizesInStock:async()=>({tamanhos:[]})};
const cfg={apiKey:"unused",baseURL:"unused",timeoutMs:100};
Deno.test("simulação não original link direto sem chamada externa",async()=>{const r=await runAgent(cfg,"unused","",null,triage,[],deps,()=>{});assertEquals(r.link?.tipo,"devolucao");assertEquals(r.text.includes("{{link}}"),true);});
Deno.test("simulação oferta já inclui link",async()=>{const r=await runAgent(cfg,"unused","",null,{...triage,facts:{}},[],deps,()=>{});assertEquals(r.exchangeOffered,true);assertEquals(r.link?.tipo,"troca");});
Deno.test("CPF antes de confirmação não acessa dados completos",async()=>{const r=await runAgent(cfg,"unused","",null,triage,[],{...deps,orders:[],cpfLookup:async()=>({found:true,first_name:"Ana",product:"Tênis",month:"11/2026",confirmed:false})},()=>{});assertEquals(r.link,null);assertEquals(r.text,"Encontrei um pedido no nome de Ana. É o do Tênis comprado em 11/2026?");});
Deno.test("consolidação impede link e não move",async()=>{const r=await runAgent(cfg,"unused","",null,triage,[],{...deps,consolidation:{id:"B",label:"Loja B"}},()=>{});assertEquals(r.link,null);assertEquals(finalDecision(r,deps.orders).decision,"consolidar_em_outra_instancia");});