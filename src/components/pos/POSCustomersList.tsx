import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, Loader2, MessageCircle, User, ChevronLeft, ChevronRight,
  Eye, MapPin, Wallet, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { NewConversationDialog } from "./NewConversationDialog";
import { EditCustomerDialog } from "./EditCustomerDialog";

interface Props {
  /** Open the 360 profile for a given query (cpf or phone). */
  onOpenProfile?: (query: string) => void;
}

interface UnifiedRow {
  id: string;
  name: string | null;
  cpf: string | null;
  email: string | null;
  phone_e164: string | null;
  phone_suffix8: string | null;
  city: string | null;
  state: string | null;
  total_orders: number | null;
  total_spent: number | null;
  avg_ticket: number | null;
  last_purchase_at: string | null;
}

const PAGE_SIZE = 30;

const fmtMoney = (v?: number | null) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

const TICKET_BANDS: Record<string, [number, number | null]> = {
  "0-100": [0, 100],
  "100-300": [100, 300],
  "300-600": [300, 600],
  "600+": [600, null],
};

const LAST_PURCHASE_PRESETS: Record<string, number> = {
  "30": 30,
  "90": 90,
  "180": 180,
  "365": 365,
};

export function POSCustomersList({ onOpenProfile }: Props) {
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [ticketBand, setTicketBand] = useState<string>("all");
  const [lastPurchase, setLastPurchase] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [sellerFilter, setSellerFilter] = useState<string>("all");

  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [sellers, setSellers] = useState<{ id: string; name: string; store_id: string }[]>([]);
  const [allowedSuffixes, setAllowedSuffixes] = useState<string[] | null>(null);

  // WhatsApp dialog
  const [waOpen, setWaOpen] = useState(false);
  const [waPhone, setWaPhone] = useState("");
  const [waName, setWaName] = useState("");

  // Load stores + sellers once
  useEffect(() => {
    supabase.from("pos_stores").select("id, name").order("name").then(({ data }) => {
      setStores((data as any[]) || []);
    });
    supabase.from("pos_sellers").select("id, name, store_id").eq("is_active", true).order("name").then(({ data }) => {
      setSellers((data as any[]) || []);
    });
  }, []);

  // When store/seller filter changes, derive the allowed phone suffixes from pos_sales.
  useEffect(() => {
    let cancelled = false;
    async function deriveSuffixes() {
      if (storeFilter === "all" && sellerFilter === "all") {
        setAllowedSuffixes(null);
        return;
      }
      let q = supabase
        .from("pos_sales")
        .select("customer_id")
        .not("customer_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (storeFilter !== "all") q = q.eq("store_id", storeFilter);
      if (sellerFilter !== "all") q = q.eq("seller_id", sellerFilter);
      const { data: salesData } = await q;
      const ids = Array.from(new Set((salesData || []).map((s: any) => s.customer_id))).slice(0, 1000);
      if (ids.length === 0) {
        if (!cancelled) setAllowedSuffixes([]);
        return;
      }
      const { data: custData } = await supabase
        .from("pos_customers")
        .select("whatsapp")
        .in("id", ids);
      const suffixes = Array.from(
        new Set(
          (custData || [])
            .map((c: any) => (c.whatsapp || "").replace(/\D/g, "").slice(-8))
            .filter((s: string) => s.length === 8),
        ),
      );
      if (!cancelled) setAllowedSuffixes(suffixes);
    }
    deriveSuffixes();
    return () => { cancelled = true; };
  }, [storeFilter, sellerFilter]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("customers_unified")
        .select(
          "id, name, cpf, email, phone_e164, phone_suffix8, city, state, total_orders, total_spent, avg_ticket, last_purchase_at",
          { count: "exact" },
        );

      // Search
      const term = search.trim();
      if (term.length >= 3) {
        const digits = term.replace(/\D/g, "");
        if (digits.length === 11) q = q.eq("cpf", digits);
        else if (digits.length >= 8) q = q.eq("phone_suffix8", digits.slice(-8));
        else q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
      }

      // Ticket band
      if (ticketBand !== "all") {
        const [min, max] = TICKET_BANDS[ticketBand];
        q = q.gte("avg_ticket", min);
        if (max != null) q = q.lt("avg_ticket", max);
      }

      // Last purchase
      if (lastPurchase !== "all") {
        const days = LAST_PURCHASE_PRESETS[lastPurchase];
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("last_purchase_at", since.toISOString());
      }

      // State
      if (stateFilter !== "all") q = q.eq("state", stateFilter);

      // Store/seller derived suffixes
      if (allowedSuffixes !== null) {
        if (allowedSuffixes.length === 0) {
          setRows([]);
          setTotal(0);
          setLoading(false);
          return;
        }
        q = q.in("phone_suffix8", allowedSuffixes);
      }

      q = q
        .order("last_purchase_at", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      setRows((data as UnifiedRow[]) || []);
      setTotal(count || 0);
    } catch (e: any) {
      toast.error("Erro ao carregar clientes: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [search, ticketBand, lastPurchase, stateFilter, allowedSuffixes, page]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  // Reset to page 0 when filters change
  useEffect(() => { setPage(0); }, [search, ticketBand, lastPurchase, stateFilter, storeFilter, sellerFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSendWhatsApp = (row: UnifiedRow) => {
    const phone = (row.phone_e164 || "").replace(/\D/g, "");
    if (phone.length < 10) {
      toast.error("Cliente sem telefone válido");
      return;
    }
    setWaPhone(phone);
    setWaName(row.name || "");
    setWaOpen(true);
  };

  const BR_STATES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

  const visibleSellers = storeFilter === "all" ? sellers : sellers.filter(s => s.store_id === storeFilter);

  return (
    <div className="flex-1 flex flex-col bg-pos-black text-pos-white overflow-hidden">
      {/* Filters */}
      <div className="p-3 md:p-4 border-b border-pos-white/10 space-y-2">
        <form
          onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/40" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por CPF, telefone, nome ou email..."
              className="pl-10 bg-pos-white/5 border-pos-white/10 text-pos-white placeholder:text-pos-white/40"
            />
          </div>
          <Button type="submit" className="bg-pos-orange hover:bg-pos-orange/90 text-white">
            Buscar
          </Button>
        </form>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="bg-pos-white/5 border-pos-white/10 text-pos-white text-xs h-9">
              <SelectValue placeholder="Loja" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={sellerFilter} onValueChange={setSellerFilter}>
            <SelectTrigger className="bg-pos-white/5 border-pos-white/10 text-pos-white text-xs h-9">
              <SelectValue placeholder="Vendedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos vendedores</SelectItem>
              {visibleSellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={ticketBand} onValueChange={setTicketBand}>
            <SelectTrigger className="bg-pos-white/5 border-pos-white/10 text-pos-white text-xs h-9">
              <SelectValue placeholder="Ticket médio" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer ticket</SelectItem>
              <SelectItem value="0-100">Até R$ 100</SelectItem>
              <SelectItem value="100-300">R$ 100 a 300</SelectItem>
              <SelectItem value="300-600">R$ 300 a 600</SelectItem>
              <SelectItem value="600+">Acima de R$ 600</SelectItem>
            </SelectContent>
          </Select>

          <Select value={lastPurchase} onValueChange={setLastPurchase}>
            <SelectTrigger className="bg-pos-white/5 border-pos-white/10 text-pos-white text-xs h-9">
              <SelectValue placeholder="Última compra" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer data</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="180">Últimos 6 meses</SelectItem>
              <SelectItem value="365">Último ano</SelectItem>
            </SelectContent>
          </Select>

          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="bg-pos-white/5 border-pos-white/10 text-pos-white text-xs h-9">
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos estados</SelectItem>
              {BR_STATES.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 md:p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-pos-orange" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 text-pos-white/40">
            <User className="h-10 w-10 mx-auto mb-3 opacity-40" />
            Nenhum cliente encontrado.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-pos-white/5 border border-pos-white/10 hover:border-pos-orange/40 transition-colors"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pos-orange/20 text-pos-orange font-bold">
                  {(c.name || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{c.name || "Sem nome"}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-pos-white/50">
                    {c.cpf && <span>CPF {c.cpf}</span>}
                    {c.phone_e164 && <span>{c.phone_e164}</span>}
                    {(c.city || c.state) && (
                      <span className="flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" /> {[c.city, c.state].filter(Boolean).join(" - ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="hidden sm:flex flex-col items-end text-xs shrink-0 mr-1">
                  <span className="flex items-center gap-1 text-pos-white/70">
                    <Wallet className="h-3 w-3" /> {fmtMoney(c.avg_ticket)}
                  </span>
                  <span className="text-pos-white/40">
                    {c.total_orders || 0} compras · {fmtDate(c.last_purchase_at)}
                  </span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-pos-white/70 hover:text-pos-white hover:bg-pos-white/10"
                    title="Ver perfil 360°"
                    onClick={() => onOpenProfile?.(c.cpf || c.phone_e164 || c.name || "")}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    className="h-8 w-8 bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                    title="Enviar WhatsApp"
                    onClick={() => handleSendWhatsApp(c)}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between p-3 border-t border-pos-white/10 text-xs text-pos-white/60">
        <span>
          {total > 0
            ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} de ${total.toLocaleString("pt-BR")}`
            : "0 clientes"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="outline"
            className="h-8 bg-pos-white/5 border-pos-white/10 text-pos-white"
            disabled={page === 0 || loading}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Badge variant="secondary" className="bg-pos-white/10 text-pos-white">
            {page + 1} / {totalPages}
          </Badge>
          <Button
            size="sm" variant="outline"
            className="h-8 bg-pos-white/5 border-pos-white/10 text-pos-white"
            disabled={page + 1 >= totalPages || loading}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <NewConversationDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        initialPhone={waPhone}
        initialName={waName}
        onConversationCreated={() => setWaOpen(false)}
      />
    </div>
  );
}
