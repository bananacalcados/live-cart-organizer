import { describe, it, expect } from 'vitest';
import { buildPrePostagemPayload, code128C, CODE128, parseNfeXml, extractPdfBase64, maskCpf, groupChave, addressProblems } from '../../supabase/functions/_shared/correios-prepost-domain';

const chave = '31261026586173000127550010000012341000012345';
const xml = `<nfeProc><NFe><infNFe Id="NFe${chave}"><ide><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-26T10:00:00-03:00</dhEmi></ide><emit><CNPJ>26586173000127</CNPJ><xNome>Banana Calçados</xNome><enderEmit><xMun>Governador Valadares</xMun><UF>MG</UF></enderEmit><IE>123</IE></emit><dest><CPF>12345678901</CPF><xNome>Maria Souza</xNome><enderDest><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><xMun>São Paulo</xMun><UF>SP</UF><CEP>01310100</CEP></enderDest></dest><det nItem="1"><prod><xProd>Tênis Samba</xProd><qCom>2.0000</qCom><vUnCom>170.9950</vUnCom></prod></det><total><ICMSTot><vNF>341.99</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><nProt>131260000000001</nProt></infProt></protNFe></nfeProc>`;
const sender = { nome: 'Banana Calçados Pérola', cnpj: '26.586.173/0001-27', telefone: '33991230581', email: '', cep: '35051-520', logradouro: 'Rua Vale Formoso', numero: '362', bairro: 'Kennedy', cidade: 'Governador Valadares', uf: 'MG' };
const sale = { id: 'abcdef12-0000-0000-0000-000000000000', customer_name: 'Maria Souza', customer_cpf: '123.456.789-01', customer_phone: '+55 (11) 98765-4321', customer_email: 'maria@x.com', shipping_address: { zip_code: '01310-100', address: 'Rua A', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'sp' } };

describe('Pré-postagem Correios', () => {
  it('lê chave, número, série, protocolo e itens do XML da NF-e', () => {
    const n = parseNfeXml(xml);
    expect(n).toMatchObject({ chave, numero: '1234', serie: '1', protocolo: '131260000000001', emitNome: 'Banana Calçados', destNome: 'Maria Souza', valorTotal: 341.99 });
    expect(n.itens).toEqual([{ descricao: 'Tênis Samba', qtd: 2, valor: 170.995 }]);
  });
  it('monta payload com os campos reais do schema e só dígitos', () => {
    const { payload, problems } = buildPrePostagemPayload({ sender, sale, serviceCode: '03220', pkg: { peso_g: 1400, c: 30, l: 20, a: 24 }, nfes: [parseNfeXml(xml)], reference: 'abcdef12' });
    expect(problems).toEqual([]);
    expect(payload.codigoServico).toBe('03220');
    expect(payload.chaveNFe).toBe(chave);
    expect(payload.numeroNotaFiscal).toBe('1234');
    expect(payload.codigoFormatoObjetoInformado).toBe('2');
    expect(payload.pesoInformado).toBe('1400');
    expect(payload.remetente).toMatchObject({ cpfCnpj: '26586173000127', dddCelular: '33', celular: '991230581' });
    expect(payload.remetente).not.toHaveProperty('email');
    expect(payload.remetente.endereco.cep).toBe('35051520');
    expect(payload.destinatario).toMatchObject({ cpfCnpj: '12345678901', dddCelular: '11', celular: '987654321', email: 'maria@x.com' });
    expect(payload.destinatario.endereco).toMatchObject({ cep: '01310100', uf: 'SP' });
    expect(payload).not.toHaveProperty('listaServicoAdicional');
    expect(payload.itensDeclaracaoConteudo[0]).toEqual({ conteudo: 'Tênis Samba', quantidade: '2', valor: '171.00' });
  });
  it('cita as demais NF-e do grupo na observação', () => {
    const second = { ...parseNfeXml(xml), numero: '1235' };
    const { payload } = buildPrePostagemPayload({ sender, sale, serviceCode: '03298', pkg: { peso_g: 700, c: 30, l: 20, a: 12 }, nfes: [parseNfeXml(xml), second], reference: 'x' });
    expect(payload.observacao).toBe('Tambem NF-e 1235');
  });
  it('recusa endereço incompleto, sem NF-e e nome sem sobrenome', () => {
    const { problems } = buildPrePostagemPayload({ sender, sale: { ...sale, customer_name: 'Maria', shipping_address: { zip_code: '123' } }, serviceCode: '03220', pkg: { peso_g: 700, c: 30, l: 20, a: 12 }, nfes: [], reference: 'x' });
    expect(problems.join(' ')).toMatch(/CEP/);
    expect(problems.join(' ')).toMatch(/NF-e autorizada/);
    expect(problems.join(' ')).toMatch(/sobrenome/);
    expect(addressProblems({ id: '1', shipping_address: {} })).toEqual(['CEP', 'logradouro', 'número', 'bairro', 'cidade', 'UF']);
  });
  it('tabela Code 128 completa e código C com start/check/stop', () => {
    expect(CODE128).toHaveLength(107);
    CODE128.slice(0, 106).forEach((p) => expect(p.split('').reduce((a, b) => a + Number(b), 0)).toBe(11));
    const m = code128C('1234');
    // start C(105) + 12 + 34 + check ((105 + 12 + 34*2) % 103 = 82) + stop
    expect(m.slice(0, 6).join('')).toBe(CODE128[105]);
    expect(m.slice(18, 24).join('')).toBe(CODE128[82]);
    expect(m.slice(-7).join('')).toBe(CODE128[106]);
    expect(() => code128C('123')).toThrow();
  });
  it('aceita PDF em base64 direto ou embrulhado', () => {
    expect(extractPdfBase64('JVBERi0xLjQ=')).toBe('JVBERi0xLjQ=');
    expect(extractPdfBase64({ dados: 'JVBERi0x' })).toBe('JVBERi0x');
    expect(extractPdfBase64({ nada: 'abc' })).toBeNull();
  });
  it('mascara CPF e agrupa a chave de 4 em 4', () => {
    expect(maskCpf('12345678901')).toBe('123.***.***-01');
    expect(groupChave(chave).split(' ')).toHaveLength(11);
  });
});
