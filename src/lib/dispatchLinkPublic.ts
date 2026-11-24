// Cliente da página pública dos Links de Disparo: só conversa com a função
// dispatch-link-public (nunca com tabelas nem com o login da equipe).
const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dispatch-link-public`;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export class LinkError extends Error {
  constructor(public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

const FRIENDLY: Record<string, string> = {
  link_inativo: "Esse link está desativado, fale com o Matthews.",
  link_vencido: "Esse link venceu, fale com o Matthews.",
  link_invalido: "Esse link não existe. Confira se copiou certinho.",
  senha_invalida: "Senha errada. Confira e tente de novo.",
  sessao_invalida: "Seu acesso terminou. Digite a senha de novo.",
  sessao_expirada: "Seu acesso venceu. Digite a senha de novo.",
  teste_obrigatorio: "Faça o teste antes de confirmar.",
  teste_invalido: "Faça o teste de novo antes de confirmar.",
  teste_falhou: "O teste não chegou. Confira o número e tente de novo.",
  teste_limite: "Você já fez muitos testes nesta hora. Espere um pouco.",
  limite_destinatarios: "Esse público passa do máximo que o link permite.",
  agendar_proibido: "Este link não deixa agendar.",
  agora_proibido: "Este link não deixa enviar na hora.",
  ja_confirmado: "Esse disparo já foi confirmado. Não precisa clicar de novo.",
  todos_bloqueados: "Ninguém desse público pode receber agora (descadastros e bloqueios).",
  imagem_obrigatoria: "Esse modelo precisa de uma foto. Escolha a foto antes de seguir.",
  templates_indisponiveis: "Não consegui carregar os modelos agora. Tente de novo em instantes.",
};

export function friendly(e: unknown) {
  if (e instanceof LinkError) return FRIENDLY[e.code] || e.message || "Algo deu errado. Tente de novo.";
  return "Sem conexão ou algo deu errado. Tente de novo.";
}

export async function callLink<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new LinkError("rede", "Sem conexão. Confira a internet e tente de novo.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    const { code, error, ...extra } = data || {};
    throw new LinkError(String(code || "erro"), String(error || "Algo deu errado."), extra);
  }
  return data as T;
}

export type VarCfg = { mode: "__static__" | "__first_name__" | "__full_name__"; staticValue?: string };
export type Tpl = { name: string; language: string; category?: string; unit_cost_brl?: number | null; components: any[]; variable_keys: string[] };

export function headerFormat(t: Tpl | null) {
  const h = t?.components?.find((c: any) => String(c.type).toUpperCase() === "HEADER");
  return h ? String(h.format || "TEXT").toUpperCase() : null;
}

/** Mesma montagem do servidor, com nomes de exemplo para a pré-visualização. */
export function previewParts(t: Tpl, vars: Record<string, VarCfg>) {
  const fill = (prefix: string, text: string) => text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = vars[`${prefix}_${n}`];
    if (!v) return "____";
    if (v.mode === "__static__") return v.staticValue?.trim() || "____";
    return v.mode === "__full_name__" ? "Maria Souza" : "Maria";
  });
  let header = "", body = "", footer = "";
  const buttons: string[] = [];
  for (const c of t.components || []) {
    const ty = String(c.type).toUpperCase();
    if (ty === "HEADER" && c.text) header = fill("header", c.text);
    if (ty === "BODY" && c.text) body = fill("body", c.text);
    if (ty === "FOOTER" && c.text) footer = c.text;
    if (ty === "BUTTONS") for (const b of c.buttons || []) buttons.push(String(b.text || ""));
  }
  return { header, body, footer, buttons };
}

/** "Impressão" do que o teste cobre (instância, modelo, campos e foto). */
export function configKey(instanceId: string, t: Tpl | null, vars: Record<string, VarCfg>, image: string | null) {
  const v = Object.keys(vars).sort().map((k) => [k, vars[k].mode, vars[k].mode === "__static__" ? (vars[k].staticValue || "").trim() : ""]);
  return JSON.stringify([instanceId, t?.name, t?.language, v, headerFormat(t) === "IMAGE" ? image : null]);
}

/** Data e hora digitadas em horário de Brasília (UTC-3) → ISO. */
export function brasiliaToIso(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00-03:00`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function formatBrasilia(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export const COMM_LABELS: Record<string, string> = {
  convite_live: "Convite para live", oferta: "Oferta", reativacao: "Chamar cliente sumida", lancamento: "Lançamento", pesquisa: "Pesquisa",
};

export const CATEGORY_INFO: Record<string, { label: string; cls: string }> = {
  MARKETING: { label: "Marketing", cls: "bg-accent text-accent-foreground" },
  UTILITY: { label: "Utilidade", cls: "bg-stage-shipped text-primary-foreground" },
  AUTHENTICATION: { label: "Autenticação", cls: "bg-stage-pre-sale text-primary-foreground" },
};

export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2.456 mensagens × R$ 0,39 ≈ R$ 957,84" */
export function costLine(total: number, unit: number | null | undefined) {
  if (unit == null) return null;
  return `${total.toLocaleString("pt-BR")} mensagens × ${brl(unit)} ≈ ${brl(Math.round(total * unit * 100) / 100)}`;
}

export type Seg = { text: string } | { slot: number; value: string | null; example: boolean };

/** Quebra o texto do modelo em pedaços, marcando cada {{n}} com o que foi digitado (ou vazio). */
export function fillSegments(prefix: string, text: string, vars: Record<string, VarCfg>): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const n = Number(m[1]);
    const v = vars[`${prefix}_${n}`];
    if (!v) out.push({ slot: n, value: null, example: false });
    else if (v.mode === "__static__") out.push({ slot: n, value: v.staticValue?.trim() || null, example: false });
    else out.push({ slot: n, value: v.mode === "__full_name__" ? "Maria Silva" : "Maria", example: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Trecho do texto em volta do espaço: "Olá ___, temos novidades". */
export function slotContext(t: Tpl, key: string) {
  const [prefix, n] = [key.slice(0, key.lastIndexOf("_")), key.slice(key.lastIndexOf("_") + 1)];
  const comp = (t.components || []).find((c: any) => String(c.type).toUpperCase() === prefix.toUpperCase());
  const text: string = comp?.text || "";
  const i = text.indexOf(`{{${n}}}`);
  if (i < 0) return "";
  const clean = (s: string) => s.replace(/\{\{(\d+)\}\}/g, "[$1]").replace(/\s+/g, " ");
  const end = i + n.length + 4;
  const before = clean(text.slice(Math.max(0, i - 28), i)).trimStart();
  const after = clean(text.slice(end, end + 28)).trimEnd();
  return `${i > 28 ? "…" : ""}${before}___${after}${end + 28 < text.length ? "…" : ""}`.replace(/\s+/g, " ").trim();
}
