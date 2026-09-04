import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";

type Filter = "talked" | "silent" | "unconfirmed";

interface ClickRow {
  id: string;
  created_at: string;
  confirmed_at: string | null;
  entered_phone: string | null;
  phone: string | null;
  real_phone: string | null;
  match_method: string | null;
  divergent: boolean;
  superseded: boolean;
  fbc: string | null;
  fbp: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  lead_id: string | null;
  lead?: { name: string | null } | null;
}

const METHOD_LABEL: Record<string, string> = {
  phone: "telefone",
  code: "código",
  time: "tempo",
  context: "contexto",
};

const fmtPhone = (p: string | null) => {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  return local;
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * Lista de cliques do link /zap com filtros:
 * - confirmou e falou (telefone digitado + mensagem casada)
 * - confirmou e não falou (lead "clicou e não falou", para retomada)
 * - sem confirmação (clique anônimo com fbc/fbp)
 */
export function LiveWhatsAppClicksList({ linkId }: { linkId: string }) {
  const [filter, setFilter] = useState<Filter>("silent");
  const [rows, setRows] = useState<ClickRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<Record<Filter, number>>({ talked: 0, silent: 0, unconfirmed: 0 });

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("live_whatsapp_clicks")
      .select("id, created_at, confirmed_at, entered_phone, phone, real_phone, match_method, divergent, superseded, fbc, fbp, utm_campaign, utm_content, lead_id, lead:event_leads(name)")
      .eq("link_id", linkId)
      .order("created_at", { ascending: false })
      .limit(500);
    const all = ((data || []) as ClickRow[]).filter((r) => !r.superseded);
    setCounts({
      talked: all.filter((r) => r.entered_phone && r.phone).length,
      silent: all.filter((r) => r.entered_phone && !r.phone).length,
      unconfirmed: all.filter((r) => !r.entered_phone && !r.phone).length,
    });
    setRows(all);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  const visible = rows.filter((r) => {
    if (filter === "talked") return !!r.entered_phone && !!r.phone;
    if (filter === "silent") return !!r.entered_phone && !r.phone;
    return !r.entered_phone && !r.phone;
  });

  const chip = (f: Filter, label: string) => (
    <Button
      key={f}
      type="button"
      size="sm"
      variant={filter === f ? "default" : "outline"}
      className="h-7 px-2 text-[11px]"
      onClick={() => setFilter(f)}
    >
      {label} <span className="ml-1 opacity-70">({counts[f]})</span>
    </Button>
  );

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-2">
      <div className="flex flex-wrap items-center gap-1">
        {chip("talked", "Confirmou e falou")}
        {chip("silent", "Clicou e não falou")}
        {chip("unconfirmed", "Sem confirmação")}
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {filter === "silent" && counts.silent > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Estes já estão salvos como leads da Live (origem "Link WhatsApp") e podem entrar em um disparo de retomada.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">Nenhum clique neste filtro.</p>
      ) : (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-background text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">Quando</th>
                <th className="py-1 pr-2 font-medium">{filter === "unconfirmed" ? "Clique" : "Telefone digitado"}</th>
                {filter === "talked" && <th className="py-1 pr-2 font-medium">Chegou como</th>}
                <th className="py-1 pr-2 font-medium">Sinais</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="py-1 pr-2 whitespace-nowrap">{fmtTime(r.confirmed_at || r.created_at)}</td>
                  <td className="py-1 pr-2">
                    {filter === "unconfirmed" ? (
                      <span className="text-muted-foreground">anônimo</span>
                    ) : (
                      <>
                        <span className="font-mono">{fmtPhone(r.entered_phone)}</span>
                        {r.lead?.name && r.lead.name !== "Lead WhatsApp" && (
                          <span className="ml-1 text-muted-foreground">{r.lead.name}</span>
                        )}
                      </>
                    )}
                  </td>
                  {filter === "talked" && (
                    <td className="py-1 pr-2">
                      <span className="font-mono">{fmtPhone(r.real_phone || r.phone)}</span>
                      {r.match_method && (
                        <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                          {METHOD_LABEL[r.match_method] || r.match_method}
                        </Badge>
                      )}
                      {r.divergent && (
                        <Badge variant="outline" className="ml-1 h-4 border-amber-500/50 px-1 text-[10px] text-amber-600">
                          divergente
                        </Badge>
                      )}
                    </td>
                  )}
                  <td className="py-1 pr-2 whitespace-nowrap">
                    {r.fbc && <Badge variant="secondary" className="mr-1 h-4 px-1 text-[10px]">fbc</Badge>}
                    {r.fbp && <Badge variant="secondary" className="mr-1 h-4 px-1 text-[10px]">fbp</Badge>}
                    {r.utm_campaign && (
                      <span className="text-muted-foreground" title={r.utm_content || undefined}>
                        {r.utm_campaign}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
