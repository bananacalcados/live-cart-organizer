import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { cepValidator, cepnetBits, parseDataMatrix, dataMatrixProblems, buildOwnLabel, ownLabelsToA4, linearModules, LABEL } from "./correios-own-label.ts";

// Decoded from the real official label of AP664805855BR (Josineide, PAC).
const OFFICIAL = "13468120011353505152000362559AP664805855BRPR1LDXn3bHTJelRjKQJHEd5Q                  0077560230032981135  Galpao                                   |";
const nfe: any = { chave: "31261016941125000156550010000025561036850200", numero: "2556", serie: "1" };
const data = {
  dataMatrix: OFFICIAL, objeto: "AP664805855BR", servico: "PAC", contrato: "9912598192", cartao: "0077560230", pesoG: 300,
  dest: { nome: "Josineide Ribeiro Silva Dios", logradouro: "Rua dos Bambus", numero: "1135", complemento: "Galpao", bairro: "Jardim Sao Paulo", cep: "13468120", cidade: "Americana", uf: "SP" },
  rem: { nome: "Banana Calçados", logradouro: "Rua Vale Formoso", numero: "362", bairro: "Kennedy", cep: "35051520", cidade: "Governador Valadares", uf: "MG", cnpj: "16941125000156" },
  nfes: [nfe],
};

Deno.test("validador do CEP: (10 - soma mod 10) mod 10", () => {
  assertEquals(cepValidator("13468120"), 5);
  assertEquals(cepValidator("35051520"), 9);
  assertEquals(cepValidator("00000000"), 0);
});
Deno.test("CEPNet: 5 barras por dígito + verificador + delimitadores", () => {
  const bits = cepnetBits("13468120");
  assertEquals(bits.length, 2 + 9 * 5);
  assertEquals(bits.slice(1, 6), "00011"); // 1
  assertEquals(bits.slice(-6, -1), "01010"); // verificador 5
  assertEquals(bits[0] + bits.at(-1), "11");
});
Deno.test("estrutura do DataMatrix oficial (IDV 59)", () => {
  const p = parseDataMatrix(OFFICIAL);
  assertEquals(OFFICIAL.length, 147);
  assertEquals([p.cepDestino, p.complementoDestino, p.cepOrigem, p.complementoOrigem, p.validador, p.idv, p.objeto], ["13468120", "01135", "35051520", "00362", "5", "59", "AP664805855BR"]);
  assertEquals(dataMatrixProblems(OFFICIAL, { objeto: "AP664805855BR", cepDestino: "13468-120", cepOrigem: "35051520" }), []);
  assertEquals(dataMatrixProblems(OFFICIAL, { objeto: "AP000000000BR", cepDestino: "13468120", cepOrigem: "35051520" }), ["objeto"]);
});
Deno.test("etiqueta própria tem 100x150 mm exatos e código do objeto >= 60 mm", async () => {
  const d = await PDFDocument.load(await buildOwnLabel(data));
  assertEquals(d.getPageCount(), 1);
  const p = d.getPage(0);
  assert(Math.abs(p.getWidth() - LABEL.w) < 0.01 && Math.abs(p.getHeight() - LABEL.h) < 0.01);
  assert(linearModules("AP664805855BR") * 0.5 >= 60);
});
Deno.test("NF-e adicional vai para segunda etiqueta; A4 põe 2 por folha", async () => {
  const pdf = await buildOwnLabel({ ...data, nfes: [nfe, { ...nfe, numero: "2557" }] });
  assertEquals((await PDFDocument.load(pdf)).getPageCount(), 2);
  assertEquals((await PDFDocument.load(await ownLabelsToA4([pdf, pdf]))).getPageCount(), 2);
});
