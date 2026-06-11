import { useEffect, useState } from "react";
import { Tag, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const PREDEFINED_TAGS = ["VIP", "Novo", "Recorrente", "Atacado", "Influencer", "Problemático"];

interface ContactTagsPopoverProps {
  phone?: string | null;
  /** Estilo compacto para caber no cabeçalho. */
  compact?: boolean;
}

/**
 * Botão "Tags" auto-contido: carrega, adiciona e remove tags de um contato
 * (tabela `chat_contacts`). Usado no cabeçalho do chat para economizar espaço.
 */
export function ContactTagsPopover({ phone, compact }: ContactTagsPopoverProps) {
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");

  useEffect(() => {
    let alive = true;
    if (!phone) {
      setTags([]);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("chat_contacts")
        .select("tags")
        .eq("phone", phone)
        .maybeSingle();
      if (alive) setTags(((data as any)?.tags as string[]) || []);
    })();
    return () => {
      alive = false;
    };
  }, [phone]);

  const addTag = async (tag: string) => {
    if (!phone || !tag.trim()) return;
    const trimmed = tag.trim();
    if (tags.includes(trimmed)) return;
    const next = [...tags, trimmed];
    setTags(next);
    setNewTag("");
    const { error } = await supabase
      .from("chat_contacts")
      .upsert({ phone, tags: next, updated_at: new Date().toISOString() }, { onConflict: "phone" });
    if (error) {
      toast.error("Erro ao salvar tag");
      setTags(tags.filter((t) => t !== trimmed));
    }
  };

  const removeTag = async (tag: string) => {
    if (!phone) return;
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    const { error } = await supabase
      .from("chat_contacts")
      .update({ tags: next, updated_at: new Date().toISOString() })
      .eq("phone", phone);
    if (error) {
      toast.error("Erro ao remover tag");
      setTags([...next, tag]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5 text-xs gap-1 text-muted-foreground"
          title="Selecionar Tags"
        >
          <Tag className="h-3.5 w-3.5" />
          <span className={compact ? "hidden xl:inline" : ""}>Tags</span>
          {tags.length > 0 && (
            <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
              {tags.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <div className="space-y-2">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs gap-1">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex gap-1">
            <Input
              placeholder="Nova tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              className="h-7 text-xs"
              onKeyDown={(e) => e.key === "Enter" && addTag(newTag)}
            />
            <Button size="sm" className="h-7" onClick={() => addTag(newTag)}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {PREDEFINED_TAGS.filter((t) => !tags.includes(t)).map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-xs cursor-pointer hover:bg-secondary"
                onClick={() => addTag(tag)}
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
