import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PAGE = 50;
type Row = { id: string; phone: string; text: string; link: string | null; requested_by: string; status: string; created_at: string; sent_at: string | null; error: string | null; provider_message_id: string | null; whatsapp_number_id: string };
const statusLabel: Record<string, string> = { pending: "Pendente", sent: "Enviada", failed: "Falhou", cancelled: "Cancelada" };

export function SupportOutboxPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [instances, setInstances] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (offset: number) => {
    setLoading(true); setError("");
    try {
      const { data, error } = await supabase.from("support_outbox")
        .select("id,phone,text,link,requested_by,status,created_at,sent_at,error,provider_message_id,whatsapp_number_id")
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      const list = (data || []) as Row[];
      setRows(prev => offset === 0 ? list : [...prev, ...list]);
      setHasMore(list.length === PAGE);
      const ids = [...new Set(list.map(r => r.whatsapp_number_id))];
      if (ids.length) {
        const { data: numbers } = await supabase.from("whatsapp_numbers").select("id,label").in("id", ids);
        if (numbers) setInstances(prev => ({ ...prev, ...Object.fromEntries(numbers.map(n => [n.id, n.label])) }));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(0); }, [load]);

  return <section className="space-y-3 rounded-lg border bg-card p-4">
    <div className="flex items-center gap-3">
      <div><h2 className="font-semibold">Enviadas pelo assistente</h2><p className="text-sm text-muted-foreground">Mensagens da Central e do assistente, inclusive pendentes e falhas.</p></div>
      <Button className="ml-auto" variant="outline" size="sm" disabled={loading} onClick={() => load(0)}><RefreshCw className="mr-1 h-4 w-4" />Atualizar</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="space-y-2">
      {rows.map(row => <article key={row.id} className="rounded-md border p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={row.status === "sent" ? "default" : row.status === "failed" ? "destructive" : "secondary"}>{statusLabel[row.status] || row.status}</Badge>
          <span className="font-medium">{instances[row.whatsapp_number_id] || "Instância de atendimento"}</span>
          <span className="text-muted-foreground">para {row.phone}</span>
          <time className="ml-auto text-xs text-muted-foreground" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString("pt-BR")}</time>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words">{row.text}{row.link ? `\n${row.link}` : ""}</p>
        <p className="mt-2 text-xs text-muted-foreground">Origem: {row.requested_by}{row.provider_message_id ? " · identificação registrada" : ""}</p>
        {row.error && <p className="mt-1 text-xs text-destructive">{row.error}</p>}
      </article>)}
      {!loading && !rows.length && !error && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma mensagem por aqui ainda.</p>}
      {loading && <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>}
      {hasMore && !loading && <Button variant="outline" className="w-full" onClick={() => load(rows.length)}>Carregar mais</Button>}
    </div>
  </section>;
}
