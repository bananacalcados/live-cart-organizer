import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Save, Trash2, Users, ArrowLeft } from "lucide-react";
import {
  AudienceFilterBuilder,
  AudienceFilter,
  emptyAudienceFilter,
  cleanAudienceFilter,
} from "./AudienceFilterBuilder";

interface CampaignRow {
  id: string;
  nome: string;
  ativa: boolean;
  filtro_json: unknown;
}

function parseFilter(raw: unknown): AudienceFilter {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if ("include" in f || "exclude" in f) {
    return {
      include: (f.include as AudienceFilter["include"]) || {},
      exclude: (f.exclude as AudienceFilter["exclude"]) || {},
    };
  }
  // Legado: objeto plano = include
  return { include: f as AudienceFilter["include"], exclude: {} };
}

export function CampaignAudienceManager() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<AudienceFilter>(emptyAudienceFilter());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("campanhas_auto")
      .select("id, nome, ativa, filtro_json")
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar públicos");
    setRows((data as CampaignRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing({ id: "", nome: "", ativa: false, filtro_json: {} });
    setName("");
    setFilter(emptyAudienceFilter());
  };

  const openEdit = (row: CampaignRow) => {
    setEditing(row);
    setName(row.nome);
    setFilter(parseFilter(row.filtro_json));
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome ao público");
      return;
    }
    setSaving(true);
    const payload = {
      nome: name.trim(),
      filtro_json: cleanAudienceFilter(filter) as unknown as never,
    };
    let error;
    if (editing?.id) {
      ({ error } = await supabase.from("campanhas_auto").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("campanhas_auto").insert(payload));
    }
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success("Público salvo");
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este público?")) return;
    const { error } = await supabase.from("campanhas_auto").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    toast.success("Público excluído");
    load();
  };

  if (editing) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="gap-2 text-neutral-700" onClick={() => setEditing(null)}>
          <ArrowLeft className="h-4 w-4" /> Voltar aos públicos
        </Button>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-neutral-600">Nome do público</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Valadares sem crediário"
            className="bg-white"
          />
        </div>

        <AudienceFilterBuilder value={filter} onChange={setFilter} />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditing(null)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving} className="gap-2 bg-blue-600 hover:bg-blue-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar público
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-neutral-800">Públicos</h3>
          <p className="text-xs text-neutral-500">
            Monte públicos combinando filtros de inclusão e exclusão.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2 bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Novo público
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-neutral-400 text-sm">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Nenhum público criado ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 hover:border-blue-300 transition-colors"
            >
              <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(r)}>
                <p className="font-medium text-neutral-800 truncate">{r.nome}</p>
              </button>
              {r.ativa && (
                <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Ativa</Badge>
              )}
              <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                Editar
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-rose-500 hover:bg-rose-50"
                onClick={() => remove(r.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
