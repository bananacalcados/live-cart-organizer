import { useState, useEffect } from "react";
import { Zap, Plus, Trash2, Pencil, X, Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface QuickReply {
  id: string;
  title: string;
  message: string;
  category: string | null;
  sort_order: number;
}

interface QuickReplyPickerProps {
  onSelect: (text: string) => void;
}

export function QuickReplyPicker({ onSelect }: QuickReplyPickerProps) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [search, setSearch] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formMessage, setFormMessage] = useState("");

  const fetchReplies = async () => {
    const { data } = await supabase
      .from("quick_replies")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true });
    if (data) setReplies(data as QuickReply[]);
  };

  useEffect(() => {
    if (open) fetchReplies();
  }, [open]);

  const filtered = replies.filter(
    (r) =>
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.message.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (reply: QuickReply) => {
    onSelect(reply.message);
    setOpen(false);
    setSearch("");
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formMessage.trim()) return;
    if (editingId) {
      const { error } = await supabase
        .from("quick_replies")
        .update({ title: formTitle.trim(), message: formMessage.trim() })
        .eq("id", editingId);
      if (error) { toast.error("Erro ao salvar"); return; }
      toast.success("Mensagem rápida atualizada");
    } else {
      const { error } = await supabase
        .from("quick_replies")
        .insert({ title: formTitle.trim(), message: formMessage.trim() });
      if (error) { toast.error("Erro ao criar"); return; }
      toast.success("Mensagem rápida criada");
    }
    resetForm();
    fetchReplies();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("quick_replies").delete().eq("id", id);
    fetchReplies();
    toast.success("Mensagem rápida removida");
  };

  const startEdit = (reply: QuickReply) => {
    setEditingId(reply.id);
    setFormTitle(reply.title);
    setFormMessage(reply.message);
    setIsAdding(true);
  };

  const resetForm = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormTitle("");
    setFormMessage("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          title="Mensagens rápidas"
        >
          <Zap className="h-5 w-5 text-amber-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" side="top">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-sm font-semibold">Mensagens Rápidas</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => (isAdding ? resetForm() : setIsAdding(true))}
          >
            {isAdding ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {isAdding ? "Cancelar" : "Nova"}
          </Button>
        </div>

        {isAdding ? (
          <div className="p-3 space-y-2">
            <Input
              placeholder="Título (ex: Saudação)"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              className="h-8 text-xs"
            />
            <Textarea
              placeholder="Mensagem..."
              value={formMessage}
              onChange={(e) => setFormMessage(e.target.value)}
              rows={3}
              className="text-xs"
            />
            <Button
              size="sm"
              className="w-full h-7 text-xs gap-1"
              onClick={handleSave}
              disabled={!formTitle.trim() || !formMessage.trim()}
            >
              <Check className="h-3 w-3" />
              {editingId ? "Atualizar" : "Salvar"}
            </Button>
          </div>
        ) : (
          <>
            {replies.length > 3 && (
              <div className="px-3 pt-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Buscar..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-7 text-xs pl-7"
                  />
                </div>
              </div>
            )}
            <ScrollArea className="max-h-[250px]">
              {filtered.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {replies.length === 0
                    ? 'Nenhuma mensagem rápida. Clique em "Nova" para criar.'
                    : "Nenhum resultado encontrado."}
                </div>
              ) : (
                <div className="p-1">
                  {filtered.map((reply) => (
                    <div
                      key={reply.id}
                      className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer"
                      onClick={() => handleSelect(reply)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{reply.title}</div>
                        <div className="text-[11px] text-muted-foreground line-clamp-2">
                          {reply.message}
                        </div>
                      </div>
                      <div className="hidden group-hover:flex gap-0.5 shrink-0 pt-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={(e) => { e.stopPropagation(); startEdit(reply); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive"
                          onClick={(e) => { e.stopPropagation(); handleDelete(reply.id); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
