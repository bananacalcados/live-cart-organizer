export const F_BUTTON_PREFIX = 'livef:';
export function instagramInteractionPayload(event: {message?:{quick_reply?:{payload?:unknown}};postback?:{payload?:unknown}}): string | null {
  const value=event.message?.quick_reply?.payload ?? event.postback?.payload;
  return typeof value==='string' ? value : null;
}
export function followupButtonJob(payload:string|null):string|null {
  const match=payload?.match(/^livef:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] || null;
}
export function isCustomerReply(event:{message?:{quick_reply?:unknown;text?:string;attachments?:unknown[]};postback?:unknown}):boolean {
  return !event.postback && !event.message?.quick_reply && !!(event.message?.text || event.message?.attachments?.length);
}
export function clickedFollowupTimes(clickedAt:Date,minutes=[10,25,45]):Date[] {
  return minutes.map(m=>new Date(clickedAt.getTime()+m*60000));
}