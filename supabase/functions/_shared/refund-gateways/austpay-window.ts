const DAY = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
function easter(year: number) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;
  return new Date(Date.UTC(year,Math.floor(n/31)-1,n%31+1));
}
export function isBrazilBusinessDay(date: Date) {
  const day=isoDay(date), year=date.getUTCFullYear();
  const fixed=["01-01","04-21","05-01","09-07","10-12","11-02","11-15",...(year>=2024?["11-20"]:[]),"12-25"];
  const goodFriday=isoDay(new Date(easter(year).getTime()-2*DAY));
  return ![0,6].includes(date.getUTCDay()) && !fixed.includes(day.slice(5)) && day!==goodFriday;
}
export function austpayRefundWindow(tx: any, now = new Date()) {
  const entries=Array.isArray(tx?.ledger_entries)?tx.ledger_entries.filter((l:any)=>l.type==="TRANSACTION"):[];
  const settled=entries.some((l:any)=>l.settled===true || !!l.fully_settled_at || l.settlement_items?.some((s:any)=>s.status==="PAID"));
  // payment_date is the documented date-only field; other aliases are tolerated if returned.
  const dates=entries.flatMap((l:any)=>[l.payment_date,l.expected_settlement_date,l.settlement_date,l.due_date]).filter((v:any)=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}/.test(v)).map((v:string)=>v.slice(0,10)).sort();
  let settlement=dates[0] || null;
  let source: "ledger"|"estimado"|"indisponivel"=settlement?"ledger":"indisponivel";
  if (!settlement && tx?.payment_method==="CREDIT_CARD" && tx.automatic_anticipation===true && Number.isFinite(Date.parse(tx.approved_at))) {
    const localDay=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(tx.approved_at));
    let d=new Date(`${localDay}T12:00:00Z`);
    do { d=new Date(d.getTime()+DAY); } while(!isBrazilBusinessDay(d));
    settlement=isoDay(d); source="estimado";
  }
  const closes=settlement?new Date(new Date(`${settlement}T00:00:00-03:00`).getTime()-1000).toISOString():null;
  const open=!settled && !!closes && now.getTime()<=Date.parse(closes);
  const note=settled?"Liquidação registrada na AustPay; estorno automático indisponível.":!closes?"Janela não verificável; confira o estorno no painel da AustPay.":`${source==="estimado"?"Prazo estimado pela antecipação D+1; não confirma liquidação efetiva. ":"Prazo informado pelos lançamentos da AustPay. "}${open?"Estorno automático dentro da janela.":"Janela da AustPay encerrada; registre somente uma devolução já feita no painel."}`;
  return {refund_window_closes_at:closes,window_source:source,gateway_window_closes_at:closes,gateway_window_open:open,gateway_window_note:note};
}