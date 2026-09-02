import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { BookmarkPlus, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export type PresetKind = "meta_template" | "wa_initial";

export interface MessagePreset<T = Record<string, unknown>> {
  id: string;
  name: string;
  kind: PresetKind;
  payload: T;
  created_at: string;
}

interface Props<T> {
  kind: PresetKind;
  /** Configuração atual a ser salva como modelo. */
  getPayload: () => T;
  /** Aplica um modelo carregado ao formulário. */
  onApply: (payload: T) => void;
  /** Desabilita "Salvar" quando não há nada configurado. */
  canSave?: boolean;
}

/**
 * Salvar/carregar modelos reutilizáveis (event_message_presets) para não
 * precisar reconfigurar template API ou mensagem não-API a cada live.
 */
export function MessagePresetControls<T extends Record<string, unknown>>({
  kind,
  getPayload,
  onApply,
  canSave = true,
}: Props<T>) {
  const [presets, setPresets] = useState<MessagePreset<T>[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string>("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("event_message_presets")
      .select("id, name, kind, payload, created_at")
      .eq("kind", kind)
      .order("name", { ascending: true });
    if (error) toast.error("Erro ao carregar modelos");
    setPresets(((data || []) as unknown) as MessagePreset<T>[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const save = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
      const payload = getPayload() as unknown as Record<string, never>;
      if (existing) {
        const { error } = await supabase
          .from("event_message_presets")
          .update({ payload })
          .eq("id", existing.id);
        if (error) throw error;
        toast.success(`Modelo "${name}" atualizado`);
      } else {
        const { data: u } = await supabase.auth.getUser();
        const { error } = await supabase
          .from("event_message_presets")
          .insert({ name, kind, payload, created_by: u?.user?.id ?? null });
        if (error) throw error;
        toast.success(`Modelo "${name}" salvo`);
      }
      setSaveName("");
      setSaveOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar modelo");
    } finally {
      setSaving(false);
    }
  };

  const apply = (id: string) => {
    setSelected(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    onApply(p.payload);
    toast.success(`Modelo "${p.name}" aplicado`);
  };

  const remove = async () => {
    const p = presets.find((x) => x.id === selected);
    if (!p) return;
    if (!confirm(`Apagar o modelo "${p.name}"?`)) return;
    const { error } = await supabase.from("event_message_presets").delete().eq("id", p.id);
    if (error) return toast.error("Erro ao apagar modelo");
    setSelected("");
    toast.success("Modelo apagado");
    load();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={selected} onValueChange={apply} disabled={loading || presets.length === 0}>
          <SelectTrigger className="h-8 w-[220px] text-xs">
            <SelectValue
              placeholder={
                loading ? "Carregando..." : presets.length === 0 ? "Nenhum modelo salvo" : "Carregar modelo salvo..."
              }
            />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={remove} title="Apagar modelo">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </div>

      <Popover open={saveOpen} onOpenChange={setSaveOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={!canSave}>
            <BookmarkPlus className="h-3.5 w-3.5" /> Salvar como modelo
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-2">
          <Label className="text-xs">Nome do modelo</Label>
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="ex.: Live Ortopédicos padrão"
            className="h-8"
            list={`preset-names-${kind}`}
          />
          <datalist id={`preset-names-${kind}`}>
            {presets.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
          <p className="text-[11px] text-muted-foreground">
            Usar um nome já existente substitui o modelo.
          </p>
          <Button type="button" size="sm" className="w-full" onClick={save} disabled={saving || !saveName.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
