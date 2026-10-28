export function RefundWindowNotice({ closesAt, open, note }: {closesAt?:string|null;open?:boolean;note?:string}) {
  if(open===undefined) return null;
  const date=closesAt?new Date(closesAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit'}):null;
  const urgent=open && !!closesAt && Date.parse(closesAt)-Date.now()<6*3600000;
  return <div className={`rounded-md border p-3 text-sm font-bold ${!open?'border-destructive/40 bg-destructive/10 text-destructive':urgent?'border-warning/40 bg-warning/10 text-warning':'border-primary/40 bg-primary/10 text-primary'}`}>
    <p>{open?`Estorno automático disponível até 23:59 de ${date}`:date?`Janela da AustPay encerrada em ${date}`:'Janela da AustPay não verificável'}</p>
    {note && <p className="mt-1 text-xs font-normal">{note}</p>}
  </div>;
}