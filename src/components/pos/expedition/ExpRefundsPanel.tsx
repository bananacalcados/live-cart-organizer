import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { refundApi, type RefundListParams, type RefundListRow } from "@/lib/refunds";
import { RefundRowCard } from "@/components/refunds/RefundRowCard";
import { RefundDecisionButtons } from "@/components/refunds/RefundDecisionButtons";
import { RefundRequestDialog } from "@/components/refunds/RefundRequestDialog";

const PAGE = 50;

function periodRange(period: string, from: string, to: string): { from?: string; to?: string } {
  const now = new Date();
  if (period === "hoje") { const d = new Date(now); d.setHours(0, 0, 0, 0); return { from: d.toISOString() }; }
  if (period === "7d") return { from: new Date(now.getTime() - 7 * 864e5).toISOString() };
  if (period === "30d") return { from: new Date(now.getTime() - 30 * 864e5).toISOString() };
  if (period === "custom") {
    return {
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    };
  }
  return {};
}

/** Expedição > ESTORNOS: aguardando aprovação, em andamento e histórico (tudo paginado no servidor). */
export function ExpRefundsPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [pending, setPending] = useState<RefundListRow[]>([]);
  const [active, setActive] = useState<RefundListRow[]>([]);
  const [history, setHistory] = useState<RefundListRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 400); return () => clearTimeout(t); }, [searchInput]);

  const historyParams = useCallback((p: number): RefundListParams => ({
    scope: "history", page: p, limit: PAGE,
    status: status === "all" ? undefined : (status as any),
    channel: channel === "all" ? undefined : (channel as any),
    search: search || undefined,
    ...periodRange(period, from, to),
  }), [status, channel, search, period, from, to]);

  const reqId = useRef(0);
  const loadAll = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const [p, a, h] = await Promise.all([
        refundApi.listScope({ scope: "pending", limit: PAGE }),
        refundApi.listScope({ scope: "active", limit: PAGE }),
        refundApi.listScope(historyParams(0)),
      ]);
      if (id !== reqId.current) return;
      setIsAdmin(p.isAdmin);
      setPending(p.rows); setActive(a.rows); setHistory(h.rows); setHasMore(h.hasMore); setPage(0);
    } catch (e: any) {
      if (id === reqId.current) setError(e?.message || "Erro ao carregar estornos");
    } finally { if (id === reqId.current) setLoading(false); }
  }, [historyParams]);

  useEffect(() => { void loadAll(); }, [loadAll, refreshKey]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const h = await refundApi.listScope(historyParams(page + 1));
      setHistory((prev) => [...prev, ...h.rows]); setHasMore(h.hasMore); setPage(page + 1);
    } finally { setLoadingMore(false); }
  };

  const reload = () => void loadAll();

  return (
    <div className="space-y-6">
      <div className="flex justify-end"><RefundRequestDialog onDone={reload} /></div>
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {!isAdmin && !loading && <p className="text-xs text-muted-foreground">Você vê só os estornos que você solicitou.</p>}

      <section>
        <h3 className="mb-2 text-lg font-black uppercase text-pos-text">Aguardando aprovação ({pending.length})</h3>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum estorno aguardando aprovação.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((r) => (
              <RefundRowCard key={r.id} r={r} actions={isAdmin ? <RefundDecisionButtons refundId={r.id} onDone={reload} /> : null} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-lg font-black uppercase text-pos-text">Em andamento ({active.length})</h3>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum estorno em andamento.</p>
        ) : (
          <div className="space-y-2">{active.map((r) => <RefundRowCard key={r.id} r={r} />)}</div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-lg font-black uppercase text-pos-text">Histórico</h3>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-10 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="7d">7 dias</SelectItem>
              <SelectItem value="30d">30 dias</SelectItem>
              <SelectItem value="all">Todo o período</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {period === "custom" && (
            <>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-40" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-40" />
            </>
          )}
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-10 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="concluido">Concluído</SelectItem>
              <SelectItem value="recusado">Recusado</SelectItem>
              <SelectItem value="falhou">Falhou</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="h-10 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Live e PDV</SelectItem>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="pdv">PDV</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Nome, telefone ou CPF" className="h-10 w-64 pl-9" />
          </div>
        </div>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum estorno encontrado.</p>
        ) : (
          <div className="space-y-2">
            {history.map((r) => <RefundRowCard key={r.id} r={r} onChanged={reload} />)}
            {hasMore && (
              <button onClick={() => void loadMore()} disabled={loadingMore} className="w-full rounded-md border border-border py-2 text-sm font-bold hover:bg-muted">
                {loadingMore ? "Carregando..." : "Carregar mais"}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
