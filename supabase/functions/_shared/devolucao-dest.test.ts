import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseXmlDest, parseXmlItems, mergeDest, cfopEntrada, cstEntradaPisCofins, precheckDevolucao, matchXmlItem } from "./devolucao-dest.ts";

const XML = `<nfeProc><dest><CPF>57212155691</CPF><xNome>Catarina Gomes</xNome><enderDest><xLgr>Av Jose</xLgr><nro>561</nro><xBairro>Estacao Velha</xBairro><cMun>3118403</cMun><xMun>Conselheiro Pena</xMun><UF>MG</UF><CEP>35241148</CEP></enderDest></dest>
<det nItem="1"><prod><cProd>789</cProd><cEAN>SEM GTIN</cEAN><xProd>TENIS</xProd><NCM>64029990</NCM><CFOP>5102</CFOP><uCom>UN</uCom></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISOutr><CST>49</CST></PISOutr></PIS></imposto></det></nfeProc>`;
const cadastro = { nome: "Outra", doc: "57212155691", ender: { xLgr: "Rua J", nro: "1", xBairro: "J", cMun: null, xMun: "Belo Horizonte", UF: "SP", CEP: "30000000" } };

Deno.test("destinatário vem do XML autorizado, não do cadastro", () => {
  const d = mergeDest(parseXmlDest(XML), cadastro);
  assertEquals(d.fonte, "xml"); assertEquals(d.ender.UF, "MG"); assertEquals(d.ender.cMun, "3118403");
  assertEquals(d.ender.xBairro, "Estacao Velha"); assertEquals(d.nome, "Catarina Gomes");
});
Deno.test("cadastro só completa o que falta no XML", () => {
  const semCep = XML.replace("<CEP>35241148</CEP>", "");
  const d = mergeDest(parseXmlDest(semCep), cadastro);
  assertEquals(d.fonte, "misto"); assertEquals(d.ender.CEP, "30000000"); assertEquals(d.ender.UF, "MG");
});
Deno.test("NFC-e sem endereço e cadastro incompleto não vai à SEFAZ", () => {
  const d = mergeDest(null, cadastro);
  const faltas = precheckDevolucao({ ender: d.ender, ufEmit: "MG", cfops: ["2202"], csts: ["98"] });
  assertEquals(faltas.includes("código do município"), true);
  assertEquals(faltas.includes("bairro"), true);
});
Deno.test("município de outro estado é barrado", () => {
  const f = precheckDevolucao({ ender: { ...parseXmlDest(XML)!.ender, UF: "RO" }, ufEmit: "MG", cfops: ["2202"], csts: ["98"] });
  assertEquals(f, ["município não bate com o estado"]);
});
Deno.test("XML completo passa na pré-checagem", () => {
  assertEquals(precheckDevolucao({ ender: parseXmlDest(XML)!.ender, ufEmit: "MG", cfops: ["1202"], csts: ["98", "98"] }), []);
});
Deno.test("CFOP de entrada por UF", () => {
  assertEquals(cfopEntrada("MG", "MG"), "1202"); assertEquals(cfopEntrada("MG", "RO"), "2202");
  assertEquals(precheckDevolucao({ ender: parseXmlDest(XML)!.ender, ufEmit: "MG", cfops: ["5102"], csts: ["98"] }), ["CFOP 5102 não é de entrada"]);
});
Deno.test("CST de saída nunca vai para a nota de entrada", () => {
  assertEquals(cstEntradaPisCofins("07", 0, 200).cst, "98");
  assertEquals(cstEntradaPisCofins("49", 0, 200).cst, "98");
  assertEquals(cstEntradaPisCofins("01", 1.65, 200), { cst: "50", aliq: 1.65, base: 200 });
  assertEquals(precheckDevolucao({ ender: parseXmlDest(XML)!.ender, ufEmit: "MG", cfops: ["1202"], csts: ["07"] }), ["CST PIS/COFINS 07 não é de entrada"]);
});
Deno.test("itens do XML: NCM, origem e unidade", () => {
  const it = matchXmlItem(parseXmlItems(XML), { sku: "789" })!;
  assertEquals([it.NCM, it.orig, it.uCom, it.csosn], ["64029990", 0, "UN", "102"]);
});
