import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, QrCode, Users, Video, Star, MousePointer, ExternalLink } from "lucide-react";

interface StoreOpt { id: string; name: string }
interface Props { stores: StoreOpt[] }

interface PageRow {
  id: string;
  slug: string;
  title: string;
  seller_id: string | null;
  store_id: string | null;
  total_views: number;
}
interface SellerRow { id: string; name: string; store_id: string | null }

interface AggBucket {
  views: number;
  clicks: number;
  vip: number;
  live: number;
  review: number;
  leads: number;
}

const TYPE_ICONS: Record<string, any> = { vip: Users, live: Video, review: Star };

export function POSSellerLinkPageProgress({ stores }: Props) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [agg, setAgg] = useState<Record<string, AggBucket>>({}); // by pageId
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: pagesData } = await supabase
        .from("link_pages")
        .select("id, slug, title, seller_id, store_id, total_views")
        .not("seller_id", "is", null);
      const sellerPages = (pagesData || []) as PageRow[];
      setPages(sellerPages);

      const sellerIds = Array.from(new Set(sellerPages.map((p) => p.seller_id).filter(Boolean))) as string[];
      if (sellerIds.length) {
        const { data: se } = await supabase.from("pos_sellers").select("id, name, store_id").in("id", sellerIds);
        setSellers((se || []) as SellerRow[]);
      } else setSellers([]);

      const pageIds = sellerPages.map((p) => p.id);
      const next: Record<string, AggBucket> = {};
      if (pageIds.length) {
        // visits with item type
        const { data: visits } = await supabase
          .from("link_page_visits")
          .select("page_id, event_type, link_page_items(item_type)")
          .in("page_id", pageIds)
          .limit(5000);
        for (const v of (visits || []) as any[]) {
          const b = (next[v.page_id] ||= { views: 0, clicks: 0, vip: 0, live: 0, review: 0, leads: 0 });
          if (v.event_type === "page_view") b.views++;
          else if (v.event_type === "click") {
            b.clicks++;
            const t = v.link_page_items?.item_type;
            if (t === "vip") b.vip++;
            else if (t === "live") b.live++;
            else if (t === "review") b.review++;
          }
        }
        // leads count
        const { data: leads } = await supabase
          .from("link_page_leads")
          .select("page_id")
          .in("page_id", pageIds)
          .limit(5000);
        for (const l of (leads || []) as any[]) {
          const b = (next[l.page_id] ||= { views: 0, clicks: 0, vip: 0, live: 0, review: 0, leads: 0 });
          b.leads++;
        }
      }
      setAgg(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    return pages.map((p) => {
      const seller = sellers.find((s) => s.id === p.seller_id);
      const store = stores.find((s) => s.id === (seller?.store_id || p.store_id));
      const b = agg[p.id] || { views: 0, clicks: 0, vip: 0, live: 0, review: 0, leads: 0 };
      const engagement = b.views ? Math.round((b.clicks / b.views) * 100) : 0;
      return { page: p, sellerName: seller?.name || "—", storeName: store?.name || "—", b, engagement };
    }).sort((a, b) => b.b.clicks - a.b.clicks);
  }, [pages, sellers, stores, agg]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  if (!rows.length) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        <QrCode className="h-7 w-7 mx-auto mb-2 opacity-40" />
        Nenhuma Link Page vinculada a vendedora ainda. Crie em Marketing → Link Pages.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={load} className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground">
          <RefreshCw className="h-3 w-3" />Atualizar
        </button>
      </div>
      {rows.map(({ page, sellerName, storeName, b, engagement }) => (
        <div key={page.id} className="border rounded-lg p-3 bg-card space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1"><Users className="h-3 w-3" />{sellerName}</Badge>
              <span className="text-xs text-muted-foreground">{storeName} · /l/{page.slug}</span>
            </div>
            <a href={`/l/${page.slug}`} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground">
              <ExternalLink className="h-3 w-3" />Abrir
            </a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
            <Stat label="Cadastros" value={b.leads} />
            <Stat label="Views" value={b.views} />
            <Stat label="Cliques" value={b.clicks} icon={MousePointer} />
            <Stat label="Grupo VIP" value={b.vip} icon={Users} />
            <Stat label="Live" value={b.live} icon={Video} />
            <Stat label="Avaliação" value={b.review} icon={Star} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Engajamento (cliques / views)</span><span>{engagement}%</span>
            </div>
            <Progress value={engagement} className="h-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon?: any }) {
  return (
    <div className="rounded-md bg-muted/40 py-2">
      <div className="flex items-center justify-center gap-1 text-base font-bold text-white">
        {Icon && <Icon className="h-3.5 w-3.5 opacity-70" />}{value}
      </div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
