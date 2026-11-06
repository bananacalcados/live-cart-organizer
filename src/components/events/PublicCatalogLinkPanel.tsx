import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { buildPublicCatalogUrl, publicCatalogUntil } from "@/lib/publicCatalogLink";

const db = supabase as any;
interface Row { group_id: string | null; group_name: string | null; utm_campaign: string | null; opens: number; views: number; orders: number; paid: number; paid_value: number }

/** Vitrine pública do catálogo (Grupos VIP): liga/desliga, validade, montador de link e resultado por grupo. */
export function PublicCatalogLinkPanel({ eventId, products }: { eventId: string; products: { id: string; title: string }[] }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [until, setUntil] = useState<string | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [groupId, setGroupId] = useState("none");
  const [campaign, setCampaign] = useState("");
  const [productId, setProductId] = useState("none");
  const [report, setReport] = useState<Row[] | null>(null);

  useEffect(() => {
    db.from("events").select("self_service_slug, public_catalog_enabled, public_catalog_until").eq("id", eventId).maybeSingle().then(({ data }: any) => {
      if (!data) return;
      setSlug(data.self_service_slug); setEnabled(!!data.public_catalog_enabled); setUntil(data.public_catalog_until);
    });
    db.from("whatsapp_groups").select("id, name").eq("is_vip", true).eq("is_active", true).order("name").limit(200).then(({ data }: any) => setGroups(data || []));
  }, [eventId]);

  const save = async (patch: Record<string, unknown>) => {
    const { error } = await db.from("events").update(patch).eq("id", eventId);
    if (error) toast.error("Erro ao salvar: " + error.message); else toast.success("Salvo");
  };
  const setHours = (h: number) => { const u = publicCatalogUntil(new Date(), h); setUntil(u); save({ public_catalog_until: u }); };

  const url = useMemo(() => slug ? buildPublicCatalogUrl(window.location.origin.includes("localhost") || window.location.origin.includes("lovable") ? window.location.origin : "https://checkout.bananacalcados.com.br", slug, {
    productId: productId !== "none" ? productId : null, groupId: groupId !== "none" ? groupId : null, campaign,
  }) : null, [slug, productId, groupId, campaign]);

  const loadReport = useCallback(async () => {
    const { data, error } = await db.rpc("public_catalog_report", { p_event_id: eventId });
    if (error) toast.error("Erro ao carregar resultado"); else setReport(data || []);
  }, [eventId]);

  const expired = until ? Date.parse(until) <= Date.now() : false;

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Switch disabled={!slug} checked={enabled} onCheckedChange={(v) => { setEnabled(v); save({ public_catalog_enabled: v }); }} />
        <Label>Link público para Grupos VIP (compra sozinha)</Label>
        {!slug && <span className="text-xs text-muted-foreground">O evento precisa de um endereço do autoatendimento.</span>}
      </div>
      {enabled && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={expired ? "font-semibold text-destructive" : "text-muted-foreground"}>
              {until ? `${expired ? "Venceu em" : "Vale até"} ${new Date(until).toLocaleString("pt-BR")}` : "Sem prazo de validade"}
            </span>
            {[24, 48, 72].map((h) => <Button key={h} size="sm" variant="outline" onClick={() => setHours(h)}>{h}h a partir de agora</Button>)}
            <Button size="sm" variant="ghost" onClick={() => { setUntil(null); save({ public_catalog_until: null }); }}>Sem prazo</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger><SelectValue placeholder="Grupo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem grupo</SelectItem>
                {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Campanha (ex.: domingo-0811)" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Produto em destaque" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Catálogo inteiro</SelectItem>
                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {url && (
            <div className="flex items-center gap-2">
              <Input readOnly value={url} className="font-mono text-xs" />
              <Button size="sm" onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copiado"); }}><Copy className="mr-1 h-4 w-4" />Copiar</Button>
            </div>
          )}
          <div>
            <Button size="sm" variant="outline" onClick={loadReport}><RefreshCw className="mr-1 h-4 w-4" />Ver resultado por grupo</Button>
            {report && (
              report.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Ainda sem acessos.</p> : (
                <table className="mt-2 w-full text-xs">
                  <thead><tr className="text-left text-muted-foreground"><th>Grupo</th><th>Campanha</th><th>Aberturas</th><th>Produtos vistos</th><th>Pedidos</th><th>Pagos</th></tr></thead>
                  <tbody>{report.map((r, i) => (
                    <tr key={i} className="border-t"><td>{r.group_name || "—"}</td><td>{r.utm_campaign || "—"}</td><td>{r.opens}</td><td>{r.views}</td><td>{r.orders}</td><td>{r.paid}</td></tr>
                  ))}</tbody>
                </table>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
