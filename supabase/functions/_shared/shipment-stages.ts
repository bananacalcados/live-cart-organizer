// Etapas públicas do acompanhamento de envio (área do cliente).
// Nunca expõe nome de transportadora nem o código real de rastreio.

export type StageKey = 'em_separacao' | 'separado' | 'embalado' | 'enviado' | 'entregue';

export type PublicEvent = {
  title: string;
  detail?: string;
  city?: string;
  state?: string;
  at: string;
};

export const STAGE_ORDER: StageKey[] = ['em_separacao', 'separado', 'embalado', 'enviado', 'entregue'];

export const STAGE_LABEL: Record<StageKey, string> = {
  em_separacao: 'Pedido em separação',
  separado: 'Pedido separado',
  embalado: 'Pedido embalado',
  enviado: 'Pedido enviado',
  entregue: 'Pedido entregue',
};

export const PICKUP_LABEL: Record<StageKey, string> = {
  em_separacao: 'Pedido em separação',
  separado: 'Pedido separado',
  embalado: 'Pedido embalado',
  enviado: 'Pronto para retirada na loja',
  entregue: 'Pedido retirado',
};

export const STAGE_DETAIL: Record<StageKey, string> = {
  em_separacao: 'Seu pedido está sendo separado no nosso estoque.',
  separado: 'Todos os itens do seu pedido foram separados e conferidos.',
  embalado: 'Seu pedido foi embalado e está pronto para seguir viagem.',
  enviado: 'Seu pedido saiu do nosso centro de distribuição.',
  entregue: 'Seu pedido foi entregue.',
};

export type StageConfig = {
  em_separacao_days: number;
  separado_days: number;
  embalado_days: number;
  business_days: boolean;
};

export const DEFAULT_STAGE_CONFIG: StageConfig = {
  em_separacao_days: 1,
  separado_days: 1,
  embalado_days: 1,
  business_days: true,
};

const DAY = 86400000;

/** Soma dias úteis (ou corridos) a uma data. */
export function addDays(from: Date, days: number, businessDays: boolean): Date {
  if (!businessDays) return new Date(from.getTime() + days * DAY);
  const d = new Date(from.getTime());
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    d.setTime(d.getTime() + DAY);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/** Horário "natural" determinístico, para as etapas não caírem todas no mesmo minuto. */
export function naturalTime(base: Date, code: string, index: number): string {
  let h = 0;
  const key = `${code}:${index}`;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const d = new Date(base);
  d.setUTCHours(12 + (h % 9), (h >> 4) % 60, (h >> 9) % 60, 0);
  return d.toISOString();
}

/**
 * Calcula até que etapa automática o pedido já chegou.
 * Nunca avança sozinho para "enviado": isso só acontece quando a expedição
 * registra o código real de rastreio.
 */
export function autoStage(startedAt: Date, cfg: StageConfig, now: Date): StageKey {
  const t1 = addDays(startedAt, cfg.em_separacao_days, cfg.business_days);
  const t2 = addDays(t1, cfg.separado_days, cfg.business_days);
  if (now >= t2) return 'embalado';
  if (now >= t1) return 'separado';
  return 'em_separacao';
}

export function stageTimes(startedAt: Date, cfg: StageConfig) {
  const t0 = startedAt;
  const t1 = addDays(t0, cfg.em_separacao_days, cfg.business_days);
  const t2 = addDays(t1, cfg.separado_days, cfg.business_days);
  return { em_separacao: t0, separado: t1, embalado: t2 };
}

const CARRIER_WORDS = [
  'correios', 'sedex', 'pac', 'jadlog', 'loggi', 'total express', 'azul', 'latam',
  'braspress', 'jamef', 'tnt', 'mandae', 'frenet', 'ects', 'dhl', 'fedex', 'buslog',
  'j&t', 'jt express', 'rodonaves', 'gollog', 'sequoia', 'directlog',
];

/** Remove qualquer referência a transportadora do texto mostrado ao cliente. */
export function sanitize(text: string): string {
  let out = String(text || '');
  for (const w of CARRIER_WORDS) {
    out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

/**
 * Traduz um evento real da transportadora para a linguagem do nosso acompanhamento.
 * "Objeto postado" nunca aparece como postagem — o cliente já viu "Pedido enviado".
 * Retorna null quando o evento não deve ser mostrado.
 */
export function translateRealEvent(
  description: string,
  fulfillment: string,
): { title: string; detail?: string; terminal?: boolean } | null {
  const t = String(description || '').toLowerCase();

  if (/entregue|entrega efetuada|delivered/.test(t)) {
    return {
      title: fulfillment === 'pickup' ? 'Pedido retirado' : 'Pedido entregue',
      detail: 'Seu pedido foi entregue.',
      terminal: true,
    };
  }
  if (/saiu para entrega|em rota de entrega|out for delivery/.test(t)) {
    return { title: 'Saiu para entrega', detail: 'Seu pedido está com o entregador.' };
  }
  if (/aguardando retirada|disponível para retirada|aguardando ser retirado/.test(t)) {
    return { title: 'Aguardando retirada', detail: 'Seu pedido está disponível para retirada.' };
  }
  if (/tentativa|não foi possível entregar|destinatário ausente|ausente/.test(t)) {
    return { title: 'Tentativa de entrega', detail: 'Não foi possível entregar. Uma nova tentativa será feita.' };
  }
  if (/devolv|retorno|reversa/.test(t)) {
    return { title: 'Pedido em retorno', detail: 'Seu pedido está retornando. Fale com a gente.' };
  }
  if (/postado|postagem|coletado|coleta|recebido pelo|posted/.test(t)) {
    return { title: 'Pedido em trânsito', detail: 'Seu pedido foi recebido na unidade de distribuição.' };
  }
  if (/trânsito|transito|encaminhado|transferência|in transit|unidade/.test(t)) {
    return { title: 'Pedido em trânsito', detail: sanitize(description) || undefined };
  }
  if (/fiscaliza|alfând|aduane|tributo/.test(t)) {
    return { title: 'Pedido em trânsito', detail: 'Seu pedido está em conferência de rotina.' };
  }
  return { title: 'Pedido em trânsito' };
}
