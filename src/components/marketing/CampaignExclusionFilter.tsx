import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Ban, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CampaignOpt {
  id: string;
  campaign_name: string | null;
  template_name: string;
  started_at: string;
  total_recipients: number | null;
}

const label = (c: CampaignOpt) =>
  `${c.campaign_name || c.template_name} · ${new Date(c.started_at).toLocaleDateString("pt-BR")}`;

/**
 * Filtro de EXCLUSÃO por campanha: remove do público quem estava em
 * uma ou mais campanhas de disparo já criadas (casamento por 8 últimos dígitos).
 */
export function CampaignExclusionFilter({
  onChange,
  removedCount,
}: {
  onChange: (suffixes: Set<string> | null) => void;
  removedCount: number;
}) {
  const [campaigns, setCampaigns] = useState<CampaignOpt[]>([]);
  const [selected, setSelected] = useState<CampaignOpt[]>([]);
  const [cache, setCache] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from("dispatch_history")
      .select("id, campaign_name, template_name, started_at, total_recipients")
      .order("started_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setCampaigns((data as CampaignOpt[]) || []));
  }, []);

  const fetchSuffixes = async (id: string): Promise<string[]> => {
    const out: string[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("dispatch_recipients")
        .select("phone")
        .eq("dispatch_id", id)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of data || []) {
        const s = String(r.phone || "").replace(/\D/g, "").slice(-8);
        if (s.length === 8) out.push(s);
      }
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

  const emit = (list: CampaignOpt[], c: Record<string, string[]>) => {
    if (list.length === 0) return onChange(null);
    const set = new Set<string>();
    for (const x of list) for (const s of c[x.id] || []) set.add(s);
    onChange(set);
  };

  const add = async (id: string) => {
    const camp = campaigns.find((c) => c.id === id);
    if (!camp || selected.some((s) => s.id === id)) return;
    setLoading(true);
    try {
      const nextCache = cache[id] ? cache : { ...cache, [id]: await fetchSuffixes(id) };
      const next = [...selected, camp];
      setCache(nextCache);
      setSelected(next);
      emit(next, nextCache);
    } catch (e) {
      toast.error("Erro ao carregar a campanha: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const remove = (id: string) => {
    const next = selected.filter((s) => s.id !== id);
    setSelected(next);
    emit(next, cache);
  };

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
      <div className="flex items-center gap-2">
        <Ban className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium">Excluir quem está em campanha</span>
        <span className="text-[10px] text-muted-foreground">(tira do público quem já estava nessas campanhas)</span>
      </div>
      <div className="flex items-center gap-2">
        <Select value="" onValueChange={add} disabled={loading}>
          <SelectTrigger className="h-8 text-xs max-w-[420px]">
            <SelectValue placeholder="Escolher campanha para excluir…" />
          </SelectTrigger>
          <SelectContent>
            {campaigns
              .filter((c) => !selected.some((s) => s.id === c.id))
              .map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {label(c)} ({c.total_recipients ?? 0})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((s) => (
            <Badge key={s.id} variant="secondary" className="text-[11px] gap-1">
              {label(s)}
              <button onClick={() => remove(s.id)} aria-label="Remover campanha">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Badge variant="destructive" className="text-[11px]">{removedCount} removidos desta audiência</Badge>
        </div>
      )}
    </div>
  );
}
