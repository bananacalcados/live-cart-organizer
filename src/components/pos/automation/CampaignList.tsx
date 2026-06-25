import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Zap, Pencil, BarChart3 } from "lucide-react";
import { CampaignBuilder } from "./CampaignBuilder";
import { CampaignDashboard } from "./CampaignDashboard";

interface Row {
  id: string;
  nome: string;
  ativa: boolean;
  template_modelo: string | null;
  qtd_por_dia: number;
  dias_semana: number[];
  whatsapp_number_id: string | null;
  publico_id: string | null;
}

const DAY_LABEL: Record<number, string> = { 0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb" };

export function CampaignList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "builder">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [numberLabels, setNumberLabels] = useState<Record<string, string>>({});
  const [publicoLabels, setPublicoLabels] = useState<Record<string, string>>({});
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("campanhas_auto")
      .select("id, nome, ativa, template_modelo, qtd_por_dia, dias_semana, whatsapp_number_id, publico_id")
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar automações");
    const list = (data as Row[]) || [];
    setRows(list);

    const [{ data: nums }, { data: pubs }, { data: cards }] = await Promise.all([
      supabase.from("whatsapp_numbers").select("id, label, phone_display"),
      supabase.from("campanha_publicos").select("id, nome"),
      supabase.from("campanha_cards").select("campanha_id").eq("status", "ok"),
    ]);
    const nl: Record<string, string> = {};
    (nums || []).forEach((n: { id: string; label: string | null; phone_display: string | null }) => {
      nl[n.id] = n.label || n.phone_display || n.id;
    });
    setNumberLabels(nl);
    const pl: Record<string, string> = {};
    (pubs || []).forEach((p: { id: string; nome: string }) => { pl[p.id] = p.nome; });
    setPublicoLabels(pl);
    const cc: Record<string, number> = {};
    (cards || []).forEach((c: { campanha_id: string }) => { cc[c.campanha_id] = (cc[c.campanha_id] || 0) + 1; });
    setCardCounts(cc);
    setLoading(false);
  };

  useEffect(() => { if (view === "list") load(); }, [view]);

  const toggleActive = async (row: Row) => {
    const { error } = await supabase.from("campanhas_auto").update({ ativa: !row.ativa }).eq("id", row.id);
    if (error) { toast.error("Erro ao atualizar"); return; }
    toast.success(row.ativa ? "Automação pausada" : "Automação ativada");
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta automação? Os cards e o histórico de fila serão removidos.")) return;
    await supabase.from("campanha_cards").delete().eq("campanha_id", id);
    const { error } = await supabase.from("campanhas_auto").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir"); return; }
    toast.success("Automação excluída");
    load();
  };

  if (view === "builder") {
    return <CampaignBuilder editingId={editingId} onClose={() => { setEditingId(null); setView("list"); }} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-neutral-800">Automações</h3>
          <p className="text-xs text-neutral-500">
            Configure o template, as imagens, o público, os limites e inicie os disparos automáticos.
          </p>
        </div>
        <Button onClick={() => { setEditingId(null); setView("builder"); }} className="gap-2 bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Nova automação
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-neutral-400 text-sm">
          <Zap className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Nenhuma automação criada ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 hover:border-blue-300 transition-colors">
              <button className="min-w-0 flex-1 text-left" onClick={() => { setEditingId(r.id); setView("builder"); }}>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-neutral-800 truncate">{r.nome}</p>
                  {r.ativa
                    ? <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Ativa</Badge>
                    : <Badge variant="outline" className="text-[10px] text-neutral-500">Pausada</Badge>}
                </div>
                <p className="text-[11px] text-neutral-400 truncate">
                  {r.whatsapp_number_id ? numberLabels[r.whatsapp_number_id] || "—" : "Sem instância"}
                  {r.template_modelo ? ` · ${r.template_modelo}` : ""}
                  {r.publico_id ? ` · 👥 ${publicoLabels[r.publico_id] || "público"}` : " · sem público"}
                  {` · ${cardCounts[r.id] || 0} cards`}
                  {` · ${r.qtd_por_dia}/dia`}
                  {` · ${(r.dias_semana || []).map((d) => DAY_LABEL[d]).join(" ")}`}
                </p>
              </button>
              <Switch checked={r.ativa} onCheckedChange={() => toggleActive(r)} />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingId(r.id); setView("builder"); }}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500 hover:bg-rose-50" onClick={() => remove(r.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
