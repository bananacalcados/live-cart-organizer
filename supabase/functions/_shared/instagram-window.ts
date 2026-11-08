export interface InstagramWindow {
  window_open: boolean; window_until: string | null;
  comment_ids: string[]; live_comment_ids: string[]; private_until: string | null;
  live_active: boolean; number_id: string | null;
}
export function instagramSendMode(context: InstagramWindow, step = 0) {
  if (context.window_open) return 'direct_dm';
  if (step > 0) return 'meta_window_closed';
  if (context.comment_ids.length) return 'private_reply';
  if (!context.live_active && context.live_comment_ids.length) return 'live_ended_no_private_reply';
  return 'no_eligible_comment';
}
export function instagramWindowLabel(context: InstagramWindow, now = Date.now()) {
  const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  if (context.window_open && context.window_until && Date.parse(context.window_until)>now) return `Janela aberta até ${time(context.window_until)}`;
  if (context.comment_ids.length && context.private_until && Date.parse(context.private_until)>now) return `Pode responder 1 vez pelo comentário (até ${time(context.private_until)} ou até o fim da live)`;
  return 'Sem janela: aguarde ela mandar mensagem';
}