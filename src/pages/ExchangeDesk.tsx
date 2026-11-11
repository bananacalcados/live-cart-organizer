// Fase 3 — Painel do Atendente: fila de exceções das Centrais de Troca/Devolução.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Search, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deskCall } from "@/components/exchange-desk/api";
import { ExchangeDeskCard } from "@/components/exchange-desk/ExchangeDeskCard";
import { TemplatesEditor } from "@/components/exchange-desk/TemplatesEditor";
import { ageLabel, ageLevel, REASON_LABEL, STATUS_LABEL, type DeskTab } from "@/lib/exchangeDesk/rules";

interface Row {
  id: string; request_type: string; first_name: string; phone: string; order_ref: string | null; order_number: string | null;
  product_name: string | null; product_size: string | null; desired_size: string | null; requested_quantity: number | null;
  reason: string | null; status: string; escalated_reason: string | null; created_at: string; assigned_to: string | null;
}
const PAGE = 50;

export default function ExchangeDesk() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("aba") as DeskTab) || "precisa";
  const [type, setType] = useState("all");
  const [reason, setReason] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(params.get("id"));
  const [tplOpen, setTplOpen] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 400); return () => clearTimeout(t); }, [search]);
  useEffect(() => { deskCall<{ id: string; name: string }[]>("exchange_desk_staff_list").then(setStaff).catch(() => setStaff([])); }, []);

  const load = useCallback(async (offset: number) => {
    setLoading(true); setErr(null);
    try {
      const data = await deskCall<Row[]>("exchange_desk_list", {
        p_tab: tab, p_type: type === "all" ? null : type, p_reason: reason === "all" ? null : reason,
        p_assignee: assignee === "all" ? null : assignee, p_search: debounced || null, p_limit: PAGE, p_offset: offset,
      });
      setRows((prev) => (offset === 0 ? data : [...prev, ...data]));
      setHasMore(data.length === PAGE);
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao carregar"); }
    finally { setLoading(false); }
  }, [tab, type, reason, assignee, debounced]);
  useEffect(() => { load(0); }, [load]);

  const staffName = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s.name])), [staff]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-lg font-semibold flex-1">Atendimento de trocas e devoluções</h1>
        <Button variant="outline" size="sm" onClick={() => setTplOpen(true)}><FileText className="h-4 w-4 mr-1" />Mensagens prontas</Button>
      </header>
      <main className="p-4 max-w-6xl mx-auto space-y-3">
        <Tabs value={tab} onValueChange={(v) => setParams({ aba: v })}>
          <TabsList>
            <TabsTrigger value="precisa">Precisa de você</TabsTrigger>
            <TabsTrigger value="andamento">Em andamento</TabsTrigger>
            <TabsTrigger value="concluidas">Concluídas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-2 top-3 text-muted-foreground" />
            <Input className="pl-8" placeholder="Nome, telefone ou pedido" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          </div>
          <Select value={type} onValueChange={setType}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os tipos</SelectItem><SelectItem value="troca">Troca</SelectItem><SelectItem value="devolucao">Devolução</SelectItem></SelectContent></Select>
          <Select value={reason} onValueChange={setReason}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os motivos</SelectItem>{Object.entries(REASON_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
          <Select value={assignee} onValueChange={setAssignee}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos atendentes</SelectItem>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="space-y-2">
          {rows.map((r) => {
            const lvl = ageLevel(r.created_at);
            return (
              <button key={r.id} onClick={() => setOpenId(r.id)}
                className={`w-full text-left rounded-lg border bg-card p-3 hover:bg-muted/50 transition ${lvl === "48h" ? "border-destructive" : lvl === "24h" ? "border-primary" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.request_type === "troca" ? "default" : "secondary"}>{r.request_type === "troca" ? "Troca" : "Devolução"}</Badge>
                  <span className="font-medium">{r.first_name || "Cliente"}</span>
                  <span className="text-sm text-muted-foreground">Pedido {r.order_number || r.order_ref || "—"}</span>
                  <span className="ml-auto text-xs flex items-center gap-2">
                    {lvl !== "normal" && <Badge variant={lvl === "48h" ? "destructive" : "outline"}>+{lvl}</Badge>}
                    {ageLabel(r.created_at)}
                  </span>
                </div>
                <div className="text-sm mt-1">
                  {r.requested_quantity || 1}× {r.product_name || "Produto"}{r.product_size ? ` (nº ${r.product_size})` : ""}
                  {r.desired_size ? ` → nº ${r.desired_size}` : ""} · {REASON_LABEL[r.reason || ""] || "Motivo não informado"}
                  {tab !== "precisa" && <> · {STATUS_LABEL[r.status] || r.status}</>}
                </div>
                {r.escalated_reason && r.status === "escalado" && <div className="text-sm text-muted-foreground mt-1">Por que veio pra você: {r.escalated_reason}</div>}
                {r.status === "aprovado" && <div className="text-sm text-muted-foreground mt-1">Aprovada — falta gerar a reversa.</div>}
                {r.assigned_to && <div className="text-xs text-muted-foreground mt-1">Com: {staffName[r.assigned_to] || "atendente"}</div>}
              </button>
            );
          })}
          {!loading && rows.length === 0 && !err && <p className="text-sm text-muted-foreground py-8 text-center">Nada por aqui.</p>}
          {loading && <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>}
          {hasMore && !loading && <Button variant="outline" className="w-full" onClick={() => load(rows.length)}>Carregar mais</Button>}
        </div>
      </main>
      {openId && <ExchangeDeskCard id={openId} staff={staff} onClose={() => setOpenId(null)} onChanged={() => load(0)} />}
      <TemplatesEditor open={tplOpen} onOpenChange={setTplOpen} />
    </div>
  );
}
