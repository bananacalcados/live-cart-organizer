// Painel de Trocas e Devoluções dentro da Expedição do PDV.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, MessageCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deskCall } from "@/components/exchange-desk/api";
import { ExchangeDeskCard } from "@/components/exchange-desk/ExchangeDeskCard";
import { TemplatesEditor } from "@/components/exchange-desk/TemplatesEditor";
import { CentralProductChoiceToggle } from "@/components/exchange-desk/CentralProductChoiceToggle";
import { AutoSuggestionsPanel } from "@/components/exchange-desk/AutoSuggestionsPanel";
import { TrainingPanel } from "@/components/exchange-desk/TrainingPanel";
import { SupportCostPanel } from "@/components/exchange-desk/SupportCostPanel";
import { SupportOutboxPanel } from "@/components/exchange-desk/SupportOutboxPanel";
import { SupportConversationsPanel } from "@/components/exchange-desk/SupportConversationsPanel";
import { SupportAiHealthAlert } from "@/components/exchange-desk/SupportAiHealthAlert";
import { AutoReplySettings } from "@/components/exchange-desk/AutoReplySettings";
import { AiAgentSettings } from "@/components/exchange-desk/AiAgentSettings";
import { POSTaskWhatsAppDialog } from "@/components/pos/POSTaskWhatsAppDialog";
import { ageLabel, ageLevel, REASON_LABEL, STATUS_LABEL, type DeskTab } from "@/lib/exchangeDesk/rules";
import { exchangeDeskTabs, resolveExchangeDeskTab, type ExchangeDeskTab } from "@/lib/exchangeDesk/supportQueue";
import { useIsAdmin } from "@/hooks/useIsAdmin";

interface Row {
  id: string; request_type: string; first_name: string; customer_name: string | null; phone: string; whatsapp_number_id: string | null;
  order_ref: string | null; order_number: string | null; product_name: string | null; product_size: string | null;
  desired_size: string | null; requested_quantity: number | null; reason: string | null; status: string;
  escalated_reason: string | null; created_at: string; assigned_to: string | null; is_test?: boolean;
}
const PAGE = 50;
const TAB_LABEL: Record<ExchangeDeskTab, string> = {
  suporte: "Em suporte", precisa: "Precisa de você", andamento: "Em andamento", concluidas: "Concluídas",
  sugestoes: "Sugestões automáticas", treino: "Treino do agente", assistente: "Enviadas pelo assistente",
  roteiro: "Roteiro e IA", custo: "Custo",
};

export default function ExchangeDesk({ storeId }: { storeId: string }) {
  const [params, setParams] = useSearchParams();
  const { isAdmin } = useIsAdmin();
  const rawTab = resolveExchangeDeskTab(params.get("aba"), isAdmin);
  const isSupport = rawTab === "suporte";
  const isTraining = rawTab === "treino";
  const isOutbox = rawTab === "assistente";
  const isSuggestions = rawTab === "sugestoes";
  const isScript = rawTab === "roteiro";
  const isCost = rawTab === "custo";
  const isRequestList = !isSupport && !isTraining && !isOutbox && !isSuggestions && !isScript && !isCost;
  const tab = (isRequestList ? rawTab : "precisa") as DeskTab;
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [chat, setChat] = useState<{ phone: string; whatsappNumberId: string | null } | null>(null);

  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 400); return () => clearTimeout(timer); }, [search]);
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
  useEffect(() => { if (isRequestList) void load(0); }, [load, isRequestList]);

  const staffName = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s.name])), [staff]);
  const openChat = (phone: string, whatsappNumberId: string | null) => setChat({ phone, whatsappNumberId });
  const closeChat = () => { setChat(null); setRefreshKey((key) => key + 1); if (isRequestList) void load(0); };
  const changeTab = (value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("aba", value);
      next.delete("id");
      return next;
    }, { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Trocas e Devoluções</h1>
          <p className="text-sm text-muted-foreground">Atendimento, solicitações e suporte da cliente.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setTplOpen(true)}><FileText className="mr-1 h-4 w-4" />Mensagens prontas</Button>
      </header>
      <Tabs value={rawTab} onValueChange={changeTab}>
        <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
          {exchangeDeskTabs(isAdmin).map((value) => <TabsTrigger key={value} value={value}>{TAB_LABEL[value]}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <SupportAiHealthAlert />

      {isSupport && <SupportConversationsPanel refreshKey={refreshKey} onOpenChat={openChat} />}
      {isTraining && isAdmin && <TrainingPanel />}
      {isOutbox && <SupportOutboxPanel />}
      {isSuggestions && <AutoSuggestionsPanel />}
      {isScript && isAdmin && <div className="space-y-3"><CentralProductChoiceToggle /><AutoReplySettings /><AiAgentSettings /></div>}
      {isCost && isAdmin && <SupportCostPanel />}

      {isRequestList && <>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2 top-3 h-4 w-4 text-muted-foreground" />
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
              <article key={r.id} className={`w-full rounded-lg border bg-card p-3 ${lvl === "48h" ? "border-destructive" : lvl === "24h" ? "border-primary" : ""}`}>
                <button type="button" onClick={() => setOpenId(r.id)} className="w-full text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={r.request_type === "troca" ? "default" : "secondary"}>{r.request_type === "troca" ? "Troca" : "Devolução"}</Badge>
                    {r.is_test && <Badge variant="destructive">TESTE</Badge>}
                    <span className="font-medium">{r.first_name || "Cliente"}</span>
                    <span className="text-sm text-muted-foreground">Pedido {r.order_number || r.order_ref || "—"}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs">
                      {lvl !== "normal" && <Badge variant={lvl === "48h" ? "destructive" : "outline"}>+{lvl}</Badge>}
                      {ageLabel(r.created_at)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm">
                    {r.requested_quantity || 1}× {r.product_name || "Produto"}{r.product_size ? ` (nº ${r.product_size})` : ""}
                    {r.desired_size ? ` → nº ${r.desired_size}` : ""} · {REASON_LABEL[r.reason || ""] || "Motivo não informado"}
                    {tab !== "precisa" && <> · {STATUS_LABEL[r.status] || r.status}</>}
                  </div>
                  {r.escalated_reason && r.status === "escalado" && <div className="mt-1 text-sm text-muted-foreground">Por que veio pra você: {r.escalated_reason}</div>}
                  {r.status === "aprovado" && <div className="mt-1 text-sm text-muted-foreground">Aprovada — falta gerar a reversa.</div>}
                  {r.assigned_to && <div className="mt-1 text-xs text-muted-foreground">Com: {staffName[r.assigned_to] || "atendente"}</div>}
                </button>
                <div className="mt-3 flex justify-end border-t pt-2">
                  <Button size="sm" variant="outline" onClick={() => openChat(r.phone, r.whatsapp_number_id)} aria-label={`Abrir conversa de ${r.first_name || "cliente"}`}>
                    <MessageCircle className="mr-1 h-4 w-4" />Abrir conversa
                  </Button>
                </div>
              </article>
            );
          })}
          {!loading && rows.length === 0 && !err && <p className="py-8 text-center text-sm text-muted-foreground">Nada por aqui.</p>}
          {loading && <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>}
          {hasMore && !loading && <Button variant="outline" className="w-full" onClick={() => load(rows.length)}>Carregar mais</Button>}
        </div>
      </>}

      {openId && <ExchangeDeskCard id={openId} staff={staff} onClose={() => setOpenId(null)} onChanged={() => load(0)} onOpenChat={openChat} />}
      <TemplatesEditor open={tplOpen} onOpenChange={setTplOpen} />
      {chat && <POSTaskWhatsAppDialog open onOpenChange={(open) => { if (!open) closeChat(); }} storeId={storeId} customerPhone={chat.phone} customerWhatsappNumberId={chat.whatsappNumberId} />}
    </div>
  );
}
