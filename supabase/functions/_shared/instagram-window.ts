export interface InstagramWindow {
  window_open: boolean; window_until: string | null;
  comment_ids: string[]; live_comment_ids: string[]; private_until: string | null;
  live_active: boolean; number_id: string | null;
  manual_until?: string | null; human_agent_approved?: boolean;
}
export function instagramManualMode(context:InstagramWindow, manual:boolean, now=Date.now()) {
  if(context.window_open && (!context.window_until || Date.parse(context.window_until)>now))return 'direct_dm';
  if(manual && context.human_agent_approved===true && context.window_until && Date.parse(context.window_until)<=now && context.manual_until && Date.parse(context.manual_until)>now)return 'human_agent';
  return instagramSendMode({...context,window_open:false});
}
export function instagramMessagingFields(mode:string):{messaging_type:string;tag?:string} {
  return mode==='human_agent'?{messaging_type:'MESSAGE_TAG',tag:'HUMAN_AGENT'}:{messaging_type:'RESPONSE'};
}
export function instagramSendMode(context: InstagramWindow, step = 0) {
  if (context.window_open) return 'direct_dm';
  if (step > 0) return 'meta_window_closed';
  if (context.comment_ids.length) return 'private_reply';
  if (!context.live_active && context.live_comment_ids.length) return 'live_ended_no_private_reply';
  return 'no_eligible_comment';
}
export function instagramFollowupMode(context: InstagramWindow, step = 0) {
  if (context.window_open) return 'direct_dm';
  if (step>0) return 'meta_window_closed';
  if (!context.live_active) return 'live_ended_no_private_reply';
  return context.comment_ids.some(id=>context.live_comment_ids.includes(id)) ? 'private_reply' : 'no_eligible_comment';
}
export function instagramWindowLabel(context: InstagramWindow, now = Date.now()) {
  const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  const dateTime=(iso:string)=>new Date(iso).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const human=context.human_agent_approved===true && context.manual_until && Date.parse(context.manual_until)>now ? `Resposta manual até ${dateTime(context.manual_until)}` : 'Resposta humana até 7 dias: aguardando aprovação da Meta';
  if (context.window_open && context.window_until && Date.parse(context.window_until)>now) return `Janela automática até ${time(context.window_until)} · ${human}`;
  if(context.human_agent_approved===true && context.manual_until && Date.parse(context.manual_until)>now)return human;
  if (context.comment_ids.length && context.private_until && Date.parse(context.private_until)>now) return `Pode responder 1 vez pelo comentário (até ${time(context.private_until)} ou até o fim da live)`;
  return context.human_agent_approved===false ? `Sem janela: aguarde ela mandar mensagem · ${human}` : 'Sem janela: aguarde ela mandar mensagem';
}