import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { useIsAdmin } from '@/hooks/useIsAdmin';

export function SecurityAccessPanel({ admin = false }: { admin?: boolean }) {
  const { isAdmin } = useIsAdmin();
  const [ip,setIp] = useState('');
  const [name,setName] = useState('');
  const [blocked,setBlocked] = useState('all');
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [page,setPage] = useState(0);
  const [filters,setFilters] = useState({ ip:'',name:'',blocked:'all',from:'',to:'' });
  const { data,error,isFetching,refetch } = useQuery({
    queryKey:['security-access',admin,filters,page],enabled:isAdmin,
    queryFn:async () => {
      let q: any = admin
        ? supabase.from('admin_access_log').select('id,user_id,email,event,module,ip,user_agent,created_at')
        : supabase.from('access_log').select('id,function_name,method,path,ip,user_email,http_status,duration_ms,blocked,reason,created_at');
      if (filters.ip) q=q.eq('ip',filters.ip);
      if (filters.name) q=q.eq(admin ? 'event':'function_name',filters.name);
      if (!admin && filters.blocked !== 'all') q=q.eq('blocked',filters.blocked === 'yes');
      if (filters.from) q=q.gte('created_at',new Date(`${filters.from}T00:00:00-03:00`).toISOString());
      if (filters.to) q=q.lte('created_at',new Date(`${filters.to}T23:59:59.999-03:00`).toISOString());
      const result=await q.order('created_at',{ ascending:false }).order('id',{ ascending:false }).range(page*50,page*50+49);
      if (result.error) throw result.error;
      return result.data as Record<string,any>[];
    },
  });
  if (!isAdmin) return null;
  return <section className="space-y-4">
    <h2 className="text-lg font-semibold">{admin ? 'Ações administrativas':'Acessos às funções'}</h2>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{ e.preventDefault();setPage(0);setFilters({ ip:ip.trim(),name:name.trim(),blocked,from,to }); }}>
      <div><Label htmlFor={`ip-${admin}`}>IP</Label><Input id={`ip-${admin}`} value={ip} onChange={e=>setIp(e.target.value)} /></div>
      <div><Label htmlFor={`fn-${admin}`}>{admin ? 'Evento':'Função'}</Label><Input id={`fn-${admin}`} value={name} onChange={e=>setName(e.target.value)} /></div>
      <div><Label htmlFor={`from-${admin}`}>De</Label><Input id={`from-${admin}`} type="date" value={from} onChange={e=>setFrom(e.target.value)} /></div>
      <div><Label htmlFor={`to-${admin}`}>Até</Label><Input id={`to-${admin}`} type="date" value={to} onChange={e=>setTo(e.target.value)} /></div>
      {!admin && <Select value={blocked} onValueChange={setBlocked}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="yes">Bloqueados</SelectItem><SelectItem value="no">Não bloqueados</SelectItem></SelectContent></Select>}
      <Button type="submit" disabled={isFetching}>Filtrar</Button><Button type="button" variant="outline" onClick={()=>refetch()} disabled={isFetching}>Atualizar</Button>
    </form>
    {error && <p role="alert" className="text-destructive">Não foi possível carregar os registros.</p>}
    <div className="overflow-x-auto border border-border rounded-md"><table className="w-full text-sm"><thead className="bg-muted"><tr>{['Data','Pessoa',admin?'Evento':'Função','IP',admin?'Módulo':'Resultado'].map(h=><th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>
      {(data ?? []).map(row=><tr key={row.id} className="border-t border-border"><td className="p-3 whitespace-nowrap">{new Date(row.created_at).toLocaleString('pt-BR',{ timeZone:'America/Sao_Paulo' })}</td><td className="p-3">{row.email || row.user_email || 'Não identificado'}</td><td className="p-3 break-all">{row.event || row.function_name}</td><td className="p-3 whitespace-nowrap">{row.ip || '—'}</td><td className={`p-3 ${row.blocked?'text-destructive':''}`}>{admin ? row.module : `${row.http_status} · ${row.duration_ms} ms${row.reason?` · ${row.reason}`:''}`}</td></tr>)}
      {!data?.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">{isFetching?'Carregando…':'Nenhum registro.'}</td></tr>}
    </tbody></table></div>
    <div className="flex gap-3 items-center"><Button variant="outline" disabled={page===0 || isFetching} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span>Página {page+1}</span><Button variant="outline" disabled={data?.length!==50 || isFetching} onClick={()=>setPage(p=>p+1)}>Próxima</Button></div>
  </section>;
}