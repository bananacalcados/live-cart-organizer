import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Instagram, Phone, Search, Star, ShoppingBag, User, Sparkles } from "lucide-react";

export type OriginBucket = "lead_first_purchase" | "existing_customer" | "brand_new";

export interface OriginPerson {
  phone_key: string;
  name: string | null;
  instagram: string | null;
  bucket: OriginBucket;
  value?: number | null;
  reason?: string | null;
  created_at?: string | null;
  last_activity_at?: string | null;
  sources: {
    prior_sales?: number;
    first_prior_at?: string | null;
    in_customers_unified?: boolean;
    total_orders_unified?: number;
    first_purchase_at?: string | null;
    rfm_segment?: string | null;
    acquisition_origins?: any;
    lp_leads_tags?: string | null;
    event_leads_sources?: string | null;
    prior_catalog_reg?: boolean;
    in_chat_contacts?: boolean;
    in_zoppy?: boolean;
  };
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  people: OriginPerson[];
  kind: "buyer" | "non_buyer";
  initialBucket?: OriginBucket | "all";
}

const bucketLabel: Record<OriginBucket, string> = {
  lead_first_purchase: "Lead → 1ª compra",
  existing_customer: "Cliente recorrente",
  brand_new: "Totalmente novo",
};

const bucketColor: Record<OriginBucket, string> = {
  lead_first_purchase: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  existing_customer: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  brand_new: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

const reasonLabel: Record<string, string> = {
  checkout_started: "Iniciou checkout",
  abandoned_cart: "Carrinho abandonado",
  registered_only: "Só cadastrou",
  lead_only: "Só lead",
  unknown: "—",
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const maskPhone = (k: string) => {
  const s = String(k || "");
  if (s.length < 4) return s;
  return `(${s.slice(0, 2)}) ****-${s.slice(-4)}`;
};

export function EventOriginDrilldownDialog({
  open,
  onOpenChange,
  title,
  people,
  kind,
  initialBucket = "all",
}: Props) {
  const [bucket, setBucket] = useState<OriginBucket | "all">(initialBucket);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return people.filter((p) => {
      if (bucket !== "all" && p.bucket !== bucket) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (p.name || "").toLowerCase().includes(q) ||
          (p.instagram || "").toLowerCase().includes(q) ||
          (p.phone_key || "").includes(q)
        );
      }
      return true;
    });
  }, [people, bucket, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            size="sm"
            variant={bucket === "all" ? "default" : "outline"}
            onClick={() => setBucket("all")}
          >
            Todos ({people.length})
          </Button>
          {(["lead_first_purchase", "existing_customer", "brand_new"] as OriginBucket[]).map((b) => (
            <Button
              key={b}
              size="sm"
              variant={bucket === b ? "default" : "outline"}
              onClick={() => setBucket(b)}
            >
              {bucketLabel[b]} ({people.filter((p) => p.bucket === b).length})
            </Button>
          ))}
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-7 h-8 w-52"
              placeholder="Buscar nome, @ ou telefone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-2 py-2">
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma pessoa neste filtro.
              </p>
            )}
            {filtered.map((p) => (
              <PersonRow key={p.phone_key} person={p} kind={kind} />
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function PersonRow({ person, kind }: { person: OriginPerson; kind: "buyer" | "non_buyer" }) {
  const s = person.sources || {};
  const tags: string[] = [];
  if (s.in_customers_unified) tags.push(`Cadastro CRM${s.total_orders_unified ? ` • ${s.total_orders_unified} pedidos` : ""}`);
  if (s.rfm_segment) tags.push(`RFM: ${s.rfm_segment}`);
  if (s.lp_leads_tags) tags.push(`LP: ${s.lp_leads_tags}`);
  if (s.event_leads_sources) tags.push(`Evento: ${s.event_leads_sources}`);
  if (s.prior_catalog_reg) tags.push("Cadastro em live anterior");
  if (s.in_chat_contacts) tags.push("Contato WhatsApp");
  if (s.in_zoppy) tags.push("Base Zoppy");
  if ((s.prior_sales || 0) > 0) tags.push(`${s.prior_sales} compra(s) anterior(es)`);

  const openWa = () => {
    const p = person.phone_key.replace(/\D/g, "");
    const full = p.length <= 11 ? `55${p}` : p;
    window.open(`https://wa.me/${full}`, "_blank");
  };

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">
              {person.name || "(sem nome)"}
            </span>
            <Badge className={`text-[10px] ${bucketColor[person.bucket]}`}>
              {person.bucket === "lead_first_purchase" && <Sparkles className="h-3 w-3 mr-1" />}
              {person.bucket === "existing_customer" && <Star className="h-3 w-3 mr-1" />}
              {person.bucket === "brand_new" && <User className="h-3 w-3 mr-1" />}
              {bucketLabel[person.bucket]}
            </Badge>
            {kind === "non_buyer" && person.reason && (
              <Badge variant="outline" className="text-[10px]">
                {reasonLabel[person.reason] || person.reason}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            {person.instagram && (
              <span className="flex items-center gap-1">
                <Instagram className="h-3 w-3 text-pink-500" />
                @{person.instagram}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3 text-emerald-500" />
              {maskPhone(person.phone_key)}
            </span>
            {kind === "buyer" && person.value != null && (
              <span className="flex items-center gap-1 text-primary font-medium">
                <ShoppingBag className="h-3 w-3" />
                {brl(person.value)}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={openWa}>
            <Phone className="h-3 w-3" />
          </Button>
          {person.instagram && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={() =>
                window.open(`https://instagram.com/${person.instagram}`, "_blank")
              }
            >
              <Instagram className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t, i) => (
            <Badge key={i} variant="secondary" className="text-[10px] font-normal">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
