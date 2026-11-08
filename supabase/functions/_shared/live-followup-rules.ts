export type FollowupType = "A" | "B" | "C" | "D" | "E" | "F";
export interface FollowupStep { minutes: number; variants: string[] }
export interface FollowupConfig {
  enabled: boolean; enabled_since?: string;
  types: Record<FollowupType, { enabled: boolean; steps: FollowupStep[] }>;
  limits: { interval_min: number; interval_max: number; hourly: number; daily_customer: number; typing_min: number; typing_max: number };
}
const BC = [
  "Oi, {primeiro_nome}! Separei seu pedido da live aqui 🛍️ Como temos poucos pares, preciso que você finalize o pagamento pra garantir: {link_carrinho}\n\nDaqui a pouco volto pra ver se você finalizou o pagamento, tá bom?",
  "{primeiro_nome}, seu pedido já está separadinho 😊 É só tocar no link pra pagar no Pix ou no cartão: {link_carrinho}\n\nSe não for ficar, me avisa que eu libero pra outra cliente. Já já volto aqui pra ver se deu certo, combinado?",
  "Oii, {primeiro_nome}! Seu carrinho da live está prontinho 👇\n{link_carrinho}\n\nOs pares ficam reservados pra você por pouco tempo. Daqui a pouquinho passo aqui pra ver se finalizou o pagamento, tá?",
];
const D = [
  { minutes: 10, variants: ["E aí, {primeiro_nome}, deu certo o pagamento?", "{primeiro_nome}, conseguiu finalizar o pagamento? 😊", "Oi, {primeiro_nome}! Deu tudo certo aí com o pagamento?"] },
  { minutes: 25, variants: ["E então, {primeiro_nome}? Está com alguma dificuldade ou dúvida?", "{primeiro_nome}, ficou alguma dúvida sobre o pedido ou o pagamento? Posso te ajudar 😊", "Oi, {primeiro_nome}, aconteceu algum problema na hora de pagar? Me conta que eu te ajudo, tá?"] },
  { minutes: 45, variants: ["{primeiro_nome}, já tem quase 1 hora que você fez o pedido e ainda não finalizou. Como temos poucos pares, se não for ficar, me responde aqui pra eu poder tirar da separação e vender pra outra cliente?", "{primeiro_nome}, seu pedido está separado há quase 1 hora 🙏 Se não for ficar, me avisa aqui pra eu liberar os pares pra outra cliente, pode ser?", "Oi, {primeiro_nome}! Ainda não vi o pagamento do seu pedido. Vai ficar com ele? Se não for, me responde pra eu tirar da separação, tá bom?"] },
];
export const DEFAULT_FOLLOWUP_CONFIG: FollowupConfig = {
  enabled: false,
  limits: { interval_min: 20, interval_max: 60, hourly: 80, daily_customer: 6, typing_min: 2, typing_max: 5 },
  types: {
    A: { enabled: true, steps: [{ minutes: 5, variants: [
      "Oi, {primeiro_nome}! Vi que você começou seu cadastro da live mas não terminou 😊 Aconteceu alguma dificuldade? É só tocar aqui pra continuar: {link_cadastro}\n\nDaqui a pouco volto pra ver se você finalizou o cadastro, tá bom?",
      "{primeiro_nome}, seu cadastro da live ficou pela metade 👀 Termina por aqui, leva menos de 1 minutinho: {link_cadastro}\n\nJá já passo aqui pra ver se deu certo, combinado?",
      "Oii, {primeiro_nome}! Faltou só terminar seu cadastro pra garantir as ofertas da live 🛍️\n{link_cadastro}\n\nSe travar em alguma parte me conta. Daqui a pouquinho volto pra conferir se finalizou, tá?",
    ] }] },
    B: { enabled: true, steps: [{ minutes: 5, variants: [...BC] }] },
    C: { enabled: true, steps: [{ minutes: 5, variants: [...BC] }] },
    D: { enabled: true, steps: D },
    E: { enabled: true, steps: [
      { minutes: 180, variants: ["Oi, {primeiro_nome}! Vi que você separou mais peças no catálogo da live 😍 Seu carrinho está aqui: {link_carrinho}\n\nQuer que eu continue segurando pra você?", "{primeiro_nome}, suas peças do catálogo estão reservadas 🛍️ Finaliza por aqui: {link_carrinho}\n\nPosso manter separado pra você?", "Oii, {primeiro_nome}! Seu carrinho do catálogo ficou aberto 👇\n{link_carrinho}\n\nVai querer levar?"] },
      { minutes: 360, variants: ["{primeiro_nome}, ainda estou com suas peças do catálogo separadas 😊 {link_carrinho}\n\nConsegue finalizar hoje?", "Oi, {primeiro_nome}! Passando pra lembrar do seu carrinho do catálogo: {link_carrinho}\n\nDeu tudo certo por aí?", "{primeiro_nome}, seu carrinho do catálogo continua te esperando 🛍️ {link_carrinho}\n\nFicou alguma dúvida?"] },
      { minutes: 1440, variants: ["{primeiro_nome}, é o último aviso sobre o seu carrinho do catálogo: {link_carrinho}\n\nSe não for ficar, me avisa que eu libero os pares, tá bom?", "Oi, {primeiro_nome}! Vou precisar liberar as peças do seu carrinho do catálogo. Ainda quer ficar com elas? {link_carrinho}", "{primeiro_nome}, suas peças do catálogo estão separadas desde ontem 🙏 Se ainda quiser, finaliza aqui: {link_carrinho}\n\nSe não, me responde pra eu liberar, pode ser?"] },
    ] },
    F: { enabled: true, steps: [{ minutes: 2, variants: [...BC] }, ...D] },
  },
};

/** Brasília has no daylight saving time. All clocks passed in explicitly for tests. */
export function crossellWindow(at: Date, random = Math.random): Date {
  const local = new Date(at.getTime() - 3 * 3600_000);
  const hour = local.getUTCHours();
  if (hour >= 8 && hour < 19) return at;
  if (hour >= 19) local.setUTCDate(local.getUTCDate() + 1);
  local.setUTCHours(8, 0, 0, 0);
  return new Date(local.getTime() + 3 * 3600_000 + Math.floor(random() * 1800_000));
}
export function scheduleStep(base: Date, type: FollowupType, minutes: number, random = Math.random): Date {
  const at = new Date(base.getTime() + minutes * 60_000 + Math.floor((random() * 2 - 1) * 60_000));
  return type === "E" ? crossellWindow(at, random) : at;
}
export function renderFollowup(text: string, name: string, registration: string, cart: string): string {
  const first = name.trim().split(/\s+/)[0] || "";
  let out = text.split("{primeiro_nome}").join(first).split("{link_cadastro}").join(registration).split("{link_carrinho}").join(cart);
  if (!first) out = out.replace(/^(?:Oi|Oii|E aí|E então),\s*([!?,])/i, (_m, punctuation) => `Oi${punctuation}`).replace(/^,\s*/, "Oi! ").replace(/,\s*([!?])/g, "$1");
  return out;
}
export interface StopState { global: boolean; event: boolean; type: boolean; paid: boolean; cancelled: boolean; replied: boolean; registered: boolean; manualRecent: boolean; optedOut: boolean; lateMinutes: number }
export function stopReason(type: FollowupType, state: StopState): string | null {
  if (!state.global) return "global_disabled";
  if (!state.event) return "event_disabled";
  if (!state.type) return "type_disabled";
  if (state.paid) return "paid";
  if (state.cancelled) return "order_cancelled";
  if (state.optedOut) return "opt_out";
  if (state.manualRecent) return "human_attendance";
  if (type === "A" && state.registered) return "registration_completed";
  if (["D", "E", "F"].includes(type) && state.replied) return "customer_replied";
  if (type === "D" && state.lateMinutes > 15) return "late_step";
  return null;
}
export function quotaAllows(hourCount: number, dayCount: number, limits = DEFAULT_FOLLOWUP_CONFIG.limits) {
  return hourCount < limits.hourly && dayCount < limits.daily_customer;
}