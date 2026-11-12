import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Loader2, MessageCircle, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deskCall } from "./api";
import { STATUS_LABEL } from "@/lib/exchangeDesk/rules";
import { formatSupportAge, supportWaitInfo } from "@/lib/exchangeDesk/supportQueue";

const PAGE = 50;

type Order = { id: string; order_ref: string; status: string; expedition_stage: string | null; created_at: string; total: number; store_name: string | null };
type Request = { id: string; request_type: string; status: string; order_ref: string | null; created_at: string };
type Exchange = { id: string; code: string; type: string; status: string; created_at: string };
type Reverse = { id: string; code: string | null; status: string; created_at: string };
type Refund = { id: string; status: string; amount: number; reason: string | null; created_at: string };
export type SupportConversation = {
  phone: string;
  phone_suffix: string;
  customer_name: string;
  whatsapp_number_id: string | null;
  instance_label: string | null;
  instance_phone: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_direction: string | null;
  last_incoming_at: string | null;
  last_outgoing_at: string | null;
  waiting: boolean;
  waiting_since: string | null;
  manual_support: boolean;
  has_ticket: boolean;
  recent_orders: Order[];
  requests: Request[];
  exchanges: Exchange[];
  reverses: Reverse[];
  refunds: Refund[];
};

type Response = { total: number; rows: SupportConversation[] };

const text = (value?: string | null) => value ? value.replace(/_/g, " ") : "—";
const legacyStatus: Record<string, string> = {
  iniciada: "Iniciada", aguardando_retorno: "Aguardando retorno", recebido_conferencia: "Recebida para conferência",
  aguardando_envio: "Aguardando envio", concluida: "Concluída", cancelada: "Cancelada",
};
const refundStatus: Record<string, string> = {
  aguardando_aprovacao: "Aguardando aprovação", pendente: "Pendente", processando: "Processando",
  concluido: "Concluído", erro: "Falhou", rejeitado: "Rejeitado", cancelado: "Cancelado",
};

function RelationBadges({ row }: { row: SupportConversation }) {
  const items: { key: string; label: string }[] = [];
  for (const r of row.requests) items.push({ key: `req-${r.id}`, label: `${r.request_type === "troca" ? "Troca" : "Devolução"} · ${STATUS_LABEL[r.status] || text(r.status)}` });
  for (const r of row.exchanges) items.push({ key: `td-${r.id}`, label: `${r.code} · ${legacyStatus[r.status] || text(r.status)}` });
  for (const r of row.reverses) items.push({ key: `rv-${r.id}`, label: `Reversa ${r.code || "sem código"} · ${text(r.status)}` });
  for (const r of row.refunds) items.push({ key: `rf-${r.id}`, label: `Estorno · ${refundStatus[r.status] || text(r.status)}` });
  if (!items.length) return <p className="text-xs text-muted-foreground">Nenhuma troca, devolução, reversa ou estorno vinculado.</p>;
  return <div className="flex flex-wrap gap-1.5">{items.map((item) => <Badge key={item.key} variant="outline" className="font-normal">{item.label}</Badge>)}</div>;
}

export function SupportConversationsPanel({ refreshKey, onOpenChat }: {
  refreshKey: number;
  onOpenChat: (phone: string, whatsappNumberId: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<SupportConversation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (offset = 0, silent = false) => {
    const request = ++requestRef.current;
    if (!silent) setLoading(true);
    try {
      const data = await deskCall<Response>("exchange_support_conversations", {
        p_search: debounced || null,
        p_limit: PAGE,
        p_offset: offset,
      });
      if (request !== requestRef.current) return;
      const nextRows = data?.rows || [];
      setRows((current) => {
        const next = offset === 0 ? nextRows : [...current, ...nextRows];
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      });
      setTotal(Number(data?.total || 0));
      setError("");
    } catch (e) {
      if (request === requestRef.current) setError(e instanceof Error ? e.message : "Não foi possível carregar a fila");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [debounced]);

  useEffect(() => {
    void load(0);
    const timer = setInterval(() => {
      if (!document.hidden) void load(0, true);
    }, 30_000);
    const onVisibility = () => {
      if (!document.hidden) void load(0, true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, refreshKey]);

  const waitingCount = rows.filter((row) => row.waiting).length;

  return (
    <section className="space-y-3" aria-label="Conversas em suporte">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2 top-3 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" placeholder="Buscar por nome, telefone ou pedido" autoComplete="off" />
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(0)} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar
        </Button>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Headphones className="h-4 w-4" />
        <span>{total} conversa{total === 1 ? "" : "s"} na linha Suporte{waitingCount ? ` · ${waitingCount} esperando resposta nesta página` : ""}</span>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="space-y-2">
        {rows.map((row) => {
          const wait = supportWaitInfo(row.last_incoming_at, row.last_outgoing_at);
          const badgeVariant = wait.level === "24h" ? "destructive" : wait.level === "4h" ? "default" : "secondary";
          return (
            <article key={`${row.phone}-${row.whatsapp_number_id || "none"}`} className={`rounded-lg border bg-card p-3 space-y-3 ${wait.level === "24h" ? "border-destructive" : wait.level === "4h" ? "border-primary" : ""}`}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{row.customer_name}</span>
                    <span className="text-xs text-muted-foreground">final {row.phone_suffix}</span>
                    {wait.waiting && <Badge variant={badgeVariant}>{wait.level === "normal" ? "Aguardando" : `+${wait.level}`}</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.instance_label || "WhatsApp"}{row.instance_phone ? ` · ${row.instance_phone}` : ""}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onOpenChat(row.phone, row.whatsapp_number_id)} aria-label={`Abrir conversa de ${row.customer_name}`}>
                  <MessageCircle className="mr-1 h-4 w-4" />Abrir conversa
                </Button>
              </div>
              <div>
                <p className="line-clamp-2 text-sm">{row.last_message || "Sem mensagem"}</p>
                <p className={`mt-1 text-xs ${wait.waiting ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  {wait.waiting ? `Cliente esperando resposta ${formatSupportAge(wait.waitingSince)}` : "Última interação respondida pela loja"}
                  {row.last_message_at ? ` · ${new Date(row.last_message_at).toLocaleString("pt-BR")}` : ""}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Pedidos recentes</p>
                {row.recent_orders.length ? <div className="flex flex-wrap gap-1.5">{row.recent_orders.map((order) => (
                  <Badge key={order.id} variant="secondary" className="font-normal">Pedido {order.order_ref} · {text(order.expedition_stage || order.status)}{order.store_name ? ` · ${order.store_name}` : ""}</Badge>
                ))}</div> : <p className="text-xs text-muted-foreground">Nenhum pedido localizado por este telefone.</p>}
              </div>
              <RelationBadges row={row} />
            </article>
          );
        })}
      </div>
      {loading && <div className="flex justify-center py-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando conversas…</div>}
      {!loading && !rows.length && !error && <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma conversa na linha Suporte.</p>}
      {!loading && rows.length < total && <Button variant="outline" className="w-full" onClick={() => void load(rows.length)}>Carregar mais</Button>}
    </section>
  );
}
