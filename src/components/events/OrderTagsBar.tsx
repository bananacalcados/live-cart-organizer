import { useEffect, useState } from "react";
import { Tag, Plus, X, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface OrderTag {
  id: string;
  name: string;
  color: string;
}

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

/** Cache simples da lista global de tags + assinantes para manter todos os cards sincronizados. */
let tagsCache: OrderTag[] | null = null;
const listeners = new Set<(t: OrderTag[]) => void>();

async function loadTags(force = false): Promise<OrderTag[]> {
  if (tagsCache && !force) return tagsCache;
  const { data } = await supabase
    .from("order_tags" as any)
    .select("id, name, color")
    .order("name");
  tagsCache = ((data as any) || []) as OrderTag[];
  listeners.forEach((l) => l(tagsCache!));
  return tagsCache;
}

interface Props {
  orderId: string;
}

export function OrderTagsBar({ orderId }: Props) {
  const [allTags, setAllTags] = useState<OrderTag[]>(tagsCache || []);
  const [selected, setSelected] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[5]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const l = (t: OrderTag[]) => setAllTags(t);
    listeners.add(l);
    loadTags();
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("order_tag_assignments" as any)
        .select("tag_id")
        .eq("order_id", orderId);
      if (alive) {
        setSelected(((data as any[]) || []).map((r) => r.tag_id));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orderId]);

  const toggle = async (tagId: string) => {
    if (selected.includes(tagId)) {
      setSelected((s) => s.filter((t) => t !== tagId));
      const { error } = await supabase
        .from("order_tag_assignments" as any)
        .delete()
        .eq("order_id", orderId)
        .eq("tag_id", tagId);
      if (error) {
        toast.error("Erro ao remover etiqueta");
        setSelected((s) => [...s, tagId]);
      }
    } else {
      setSelected((s) => [...s, tagId]);
      const { error } = await supabase
        .from("order_tag_assignments" as any)
        .insert({ order_id: orderId, tag_id: tagId } as any);
      if (error) {
        toast.error("Erro ao aplicar etiqueta");
        setSelected((s) => s.filter((t) => t !== tagId));
      }
    }
  };

  const createTag = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("order_tags" as any)
      .insert({ name, color: newColor } as any)
      .select("id, name, color")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(
        String(error?.message || "").includes("duplicate")
          ? "Já existe uma etiqueta com esse nome"
          : "Erro ao criar etiqueta",
      );
      return;
    }
    setNewName("");
    await loadTags(true);
    toggle((data as any).id);
  };

  const deleteTag = async (tagId: string) => {
    const { error } = await supabase.from("order_tags" as any).delete().eq("id", tagId);
    if (error) {
      toast.error("Erro ao excluir etiqueta");
      return;
    }
    setSelected((s) => s.filter((t) => t !== tagId));
    await loadTags(true);
  };

  const applied = allTags.filter((t) => selected.includes(t.id));

  /** Fonte adaptativa: quanto maior o texto (e quanto mais etiquetas), menor a fonte. */
  const fontSizeFor = (text: string) => {
    const len = Math.max(1, text.trim().length);
    // ~90% da largura útil de um card estreito (~230px), considerando tracking largo
    let px = 200 / (len * 0.78);
    if (applied.length > 1) px *= applied.length === 2 ? 0.8 : 0.62;
    return Math.max(9, Math.min(26, px));
  };

  return (
    <>
      {/* Marca d'água diagonal sobre todo o card — puramente visual, não bloqueia cliques */}
      {applied.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden select-none px-2"
        >
          <div className="flex w-full flex-col items-center gap-2 -rotate-[24deg]">
            {applied.map((tag) => (
              <span
                key={tag.id}
                className="max-w-full truncate text-center font-black uppercase leading-tight opacity-[0.15]"
                style={{
                  color: tag.color,
                  fontSize: `${fontSizeFor(tag.name)}px`,
                  letterSpacing: tag.name.length > 14 ? "0.04em" : "0.14em",
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        </div>
      )}


      <div className="relative z-10 flex flex-wrap items-center gap-1 mb-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] gap-1 text-muted-foreground"
            onClick={(e) => e.stopPropagation()}
            title="Etiquetas"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Tag className="h-3 w-3" />}
            Etiquetas
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-2"
          align="start"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Etiquetas disponíveis</p>
            <div className="max-h-44 overflow-y-auto space-y-1">
              {allTags.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Nenhuma etiqueta criada ainda</p>
              )}
              {allTags.map((tag) => (
                <div key={tag.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggle(tag.id)}
                    className={`flex-1 flex items-center gap-2 rounded-md px-2 py-1 text-xs text-left hover:bg-secondary ${
                      selected.includes(tag.id) ? "bg-secondary" : ""
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                    {selected.includes(tag.id) && <span className="ml-auto text-[10px]">✓</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTag(tag.id)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Excluir etiqueta de todas as lives"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="border-t pt-2 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Nova etiqueta</p>
              <div className="flex gap-1">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex.: Aguardando foto"
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && createTag()}
                />
                <Button size="sm" className="h-7" onClick={createTag} disabled={creating}>
                  {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`h-5 w-5 rounded-full border-2 ${
                      newColor === c ? "border-foreground" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      </div>
    </>
  );
}
