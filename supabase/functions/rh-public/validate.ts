// Validação do cadastro de candidatura (mesma regra no servidor; o navegador só ajuda o usuário).
export const TRANSPORTES = ["a_pe", "onibus", "moto", "bicicleta", "carro"] as const;
export const COMPUTADOR = ["nunca", "um_pouco", "bem"] as const;
export const MAX_EXPERIENCIAS = 10;

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Celular BR: DDD + 9 + 8 dígitos (aceita 55 na frente). Devolve 55DDD9XXXXXXXX ou null. */
export function normalizeBrMobile(v: unknown): string | null {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 11) return null;
  if (!/^[1-9][1-9]9\d{8}$/.test(d)) return null;
  return "55" + d;
}

export function validateRhSubmission(raw: any, cenarioIds: string[], userAgent: string) {
  const errors: Record<string, string> = {};
  const r = raw && typeof raw === "object" ? raw : {};
  const nome = txt(r.nome, 120);
  if (nome.length < 3 || !/\s/.test(nome)) errors.nome = "Informe o nome completo.";
  const whatsapp = normalizeBrMobile(r.whatsapp);
  if (!whatsapp) errors.whatsapp = "WhatsApp inválido (DDD + 9 + número).";
  const idade = Number(r.idade);
  if (!Number.isInteger(idade) || idade < 1 || idade > 99) errors.idade = "Informe sua idade.";
  else if (idade < 18) errors.idade = "menor";
  const bairro = txt(r.bairro, 80);
  if (bairro.length < 2) errors.bairro = "Informe seu bairro.";
  const cidade = txt(r.cidade, 80);
  if (cidade.length < 2) errors.cidade = "Informe sua cidade.";
  const transporte = TRANSPORTES.includes(r.transporte) ? r.transporte : null;
  if (!transporte) errors.transporte = "Escolha como vem para o trabalho.";
  if (typeof r.aceita_condicoes !== "boolean") errors.aceita_condicoes = "Responda sim ou não.";
  if (typeof r.ja_trabalhou !== "boolean") errors.ja_trabalhou = "Responda sim ou não.";
  const experiencias: { onde: string; funcao: string; duracao_meses: number }[] = [];
  if (r.ja_trabalhou === true) {
    const list = Array.isArray(r.experiencias) ? r.experiencias : [];
    if (list.length < 1) errors.experiencias = "Adicione pelo menos uma experiência.";
    if (list.length > MAX_EXPERIENCIAS) errors.experiencias = `No máximo ${MAX_EXPERIENCIAS} experiências.`;
    list.slice(0, MAX_EXPERIENCIAS).forEach((e: any, i: number) => {
      const onde = txt(e?.onde, 100), funcao = txt(e?.funcao, 100);
      const tempo = Number(e?.tempo);
      const unidade = e?.unidade === "anos" ? "anos" : e?.unidade === "meses" ? "meses" : null;
      if (!onde || !funcao || !unidade || !(tempo > 0) || tempo > (unidade === "anos" ? 50 : 600)) {
        errors[`experiencias.${i}`] = "Preencha onde, o que fazia e quanto tempo.";
      } else {
        experiencias.push({ onde, funcao, duracao_meses: Math.round((unidade === "anos" ? tempo * 12 : tempo) * 10) / 10 });
      }
    });
  }
  const computador = COMPUTADOR.includes(r.computador) ? r.computador : null;
  if (!computador) errors.computador = "Escolha uma opção.";
  const situacao = txt(r.situacao, 1500);
  if (situacao.length < 15) errors.situacao = "Conte a situação em 2 ou 3 frases.";
  const respostas: Record<string, string> = {};
  const rr = r.respostas && typeof r.respostas === "object" ? r.respostas : {};
  for (const id of cenarioIds) {
    const t = typeof rr[id] === "string" ? rr[id].trim().slice(0, 600) : "";
    if (!t) errors[`respostas.${id}`] = "Responda a mensagem do cliente.";
    respostas[id] = t;
  }
  if (r.consentimento !== true) errors.consentimento = "É preciso autorizar o uso dos dados.";
  const dispositivo = /Mobi|Android|iPhone|iPad/i.test(userAgent) ? "celular" : "computador";
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return {
    ok: true as const,
    data: { nome, whatsapp, idade, bairro, cidade, transporte, aceita_condicoes: r.aceita_condicoes, ja_trabalhou: r.ja_trabalhou,
      experiencias, computador, situacao, respostas, dispositivo },
  };
}
