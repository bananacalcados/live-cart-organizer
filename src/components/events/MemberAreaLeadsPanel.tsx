import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  UserPlus, Loader2, RefreshCw, Search, Phone, Trophy, Star, Users, Download, ShoppingCart,
} from "lucide-react";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { useCustomerStore } from "@/stores/customerStore";

interface MemberAreaLead {
  id: string;
  event_id: string | null;
  event_name: string | null;
  name: string | null;
  phone: string;
  captured_at: string;
  last_seen_at: string | null;
  visits: number;
  source: string;
  is_customer: boolean;
  total_orders: number;
  total_spent: number;
  last_purchase_at: string | null;
  was_existing_lead: boolean;
  first_lead_at: string | null;
  first_lead_source: string | null;
  prize_count: number;
  prizes: { label: string; type: string; status: string; coupon: string; redeemed: boolean }[];
}

const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const fmtPhone = (raw: string) => {
  const d = String(raw || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
};

const PRIZE_STATUS_LABEL: Record<string, string> = {
  available: "disponível",
  reserved: "reservado",
  shipped: "enviado",
  forfeited: "perdido",
  expired: "expirado",
};

/**
 * Leads captados na área de membros (/minha-area).
 * `eventId` restringe ao evento (live em andamento); sem ele, mostra tudo.
 */
export function MemberAreaLeadsPanel({ eventId }: { eventId?: string | null }) {
  const [leads, setLeads] = useState<MemberAreaLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [days, setDays] = useState("30");
  const [scopeEvent, setScopeEvent] = useState(!!eventId);
  const [orderLead, setOrderLead] = useState<MemberAreaLead | null>(null);
  const fetchCustomers = useCustomerStore((s) => s.fetchCustomers);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_member_area_leads" as any, {
        p_event_id: scopeEvent && eventId ? eventId : null,
        p_days: Number(days) || 30,
        p_search: search.trim() || null,
        p_limit: 500,
      });
      if (error) throw error;
      setLeads(((data as any[]) || []) as MemberAreaLead[]);
    } catch (e) {
      console.error("[MemberAreaLeadsPanel]", e);
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [eventId, scopeEvent, days, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const stats = useMemo(() => ({
    total: leads.length,
    clientes: leads.filter((l) => l.is_customer).length,
    novos: leads.filter((l) => !l.is_customer && !l.was_existing_lead).length,
    premios: leads.filter((l) => l.prize_count > 0).length,
  }), [leads]);

  const exportCsv = () => {
    const head = ["Data", "Hora", "Nome/@", "WhatsApp", "Evento", "Situação", "Compras", "Total gasto", "Prêmios"];
    const rows = leads.map((l) => {
      const d = new Date(l.captured_at);
      return [
        d.toLocaleDateString("pt-BR"),
        d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        l.name || "",
        fmtPhone(l.phone),
        l.event_name || "",
        l.is_customer ? "Cliente" : l.was_existing_lead ? "Lead antigo" : "Lead novo",
        String(l.total_orders || 0),
        String(l.total_spent || 0),
        (l.prizes || []).map((p) => `${p.label} (${PRIZE_STATUS_LABEL[p.status] || p.status})`).join(" | "),
      ];
    });
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-area-membros-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[220px]">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" /> Leads da Área de Membros
            </CardTitle>
            <CardDescription>
              Quem entrou e se cadastrou em /minha-area — data, hora, WhatsApp, se já é cliente e prêmios da roleta.
            </CardDescription>
          </div>
          {eventId && (
            <Button
              variant={scopeEvent ? "default" : "outline"}
              size="sm"
              onClick={() => setScopeEvent((v) => !v)}
            >
              {scopeEvent ? "Somente este evento" : "Todos os eventos"}
            </Button>
          )}
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Hoje / 24h</SelectItem>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="365">1 ano</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} title="Atualizar">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!leads.length}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, @ ou WhatsApp…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Badge variant="outline" className="gap-1"><Users className="h-3 w-3" /> {stats.total} captados</Badge>
          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 gap-1">
            <Star className="h-3 w-3" /> {stats.clientes} já clientes
          </Badge>
          <Badge className="bg-sky-500/15 text-sky-700 border-sky-500/30">{stats.novos} leads novos</Badge>
          <Badge className="bg-orange-500/15 text-orange-700 border-orange-500/30 gap-1">
            <Trophy className="h-3 w-3" /> {stats.premios} com prêmio
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="max-h-[520px] overflow-y-auto overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">Captado em</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead className="w-[150px]">WhatsApp</TableHead>
                {!scopeEvent && <TableHead>Evento</TableHead>}
                <TableHead className="w-[170px]">Situação</TableHead>
                <TableHead>Prêmios da roleta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                    Nenhum lead captado na área de membros neste período.
                  </TableCell>
                </TableRow>
              ) : leads.map((l) => (
                <TableRow key={l.id} className="text-sm">
                  <TableCell className="text-xs">
                    <p className="font-medium">{new Date(l.captured_at).toLocaleDateString("pt-BR")}</p>
                    <p className="text-muted-foreground">
                      {new Date(l.captured_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      {l.visits > 1 && ` · ${l.visits} acessos`}
                    </p>
                  </TableCell>
                  <TableCell>
                    {(l.event_id || eventId) ? (
                      <button
                        type="button"
                        onClick={async () => { await fetchCustomers(); setOrderLead(l); }}
                        className="font-medium text-left text-primary hover:underline decoration-dotted flex items-center gap-1"
                        title="Montar pedido para este cliente"
                      >
                        <ShoppingCart className="h-3.5 w-3.5 opacity-70" />
                        {l.name || fmtPhone(l.phone)}
                      </button>
                    ) : (
                      <p className="font-medium">{l.name || "—"}</p>
                    )}
                    {l.was_existing_lead && l.first_lead_source && (
                      <p className="text-[11px] text-muted-foreground">
                        1ª captação: {l.first_lead_source} · {fmtDateTime(l.first_lead_at)}
                      </p>
                    )}
                  </TableCell>

                  <TableCell>
                    <a
                      href={`https://wa.me/${String(l.phone).replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs flex items-center gap-1 text-emerald-600 hover:underline"
                    >
                      <Phone className="h-3 w-3" /> {fmtPhone(l.phone)}
                    </a>
                  </TableCell>
                  {!scopeEvent && (
                    <TableCell className="text-xs text-muted-foreground">{l.event_name || "—"}</TableCell>
                  )}
                  <TableCell>
                    {l.is_customer ? (
                      <div>
                        <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[10px]">
                          Já é cliente
                        </Badge>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {l.total_orders} compra{l.total_orders === 1 ? "" : "s"} · R$ {Number(l.total_spent || 0).toFixed(2)}
                        </p>
                      </div>
                    ) : l.was_existing_lead ? (
                      <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]">
                        Lead já cadastrado
                      </Badge>
                    ) : (
                      <Badge className="bg-sky-500/15 text-sky-700 border-sky-500/30 text-[10px]">
                        Lead novo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {l.prize_count === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(l.prizes || []).map((p, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="text-[10px] bg-orange-500/10 text-orange-700 border-orange-500/30"
                            title={p.coupon ? `Cupom ${p.coupon}` : undefined}
                          >
                            🎡 {p.label} · {PRIZE_STATUS_LABEL[p.status] || p.status}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Montar pedido direto pelo lead da área de membros */}
      {orderLead && (orderLead.event_id || eventId) && (
        <OrderDialogDb
          open={!!orderLead}
          onOpenChange={(o) => {
            if (!o) {
              setOrderLead(null);
              load();
            }
          }}
          eventId={(orderLead.event_id || eventId) as string}
          prefillWhatsapp={orderLead.phone}
          prefillName={orderLead.name || undefined}
        />
      )}
    </Card>
  );
}

export default MemberAreaLeadsPanel;
