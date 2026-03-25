import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Brain, BookOpen, Truck, Clock, Store, CreditCard, HelpCircle } from "lucide-react";

interface KnowledgeItem {
  id: string;
  category: string;
  title: string;
  content: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: "frete", label: "Frete", icon: Truck },
  { value: "horario", label: "Horários", icon: Clock },
  { value: "lojas", label: "Lojas", icon: Store },
  { value: "pagamento", label: "Pagamento", icon: CreditCard },
  { value: "politica_troca", label: "Trocas/Devoluções", icon: HelpCircle },
  { value: "faq", label: "FAQ Geral", icon: BookOpen },
];

const getCategoryIcon = (category: string) => {
  const cat = CATEGORIES.find(c => c.value === category);
  return cat?.icon || HelpCircle;
};

const getCategoryLabel = (category: string) => {
  const cat = CATEGORIES.find(c => c.value === category);
  return cat?.label || category;
};

export function AiKnowledgeBase() {
  const { toast } = useToast();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<KnowledgeItem | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");

  // Form state
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("faq");
  const [content, setContent] = useState("");
  const [isActive, setIsActive] = useState(true);

  const fetchItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ai_knowledge_base")
      .select("*")
      .order("category")
      .order("sort_order");
    if (!error && data) setItems(data as KnowledgeItem[]);
    setLoading(false);
  };

  useEffect(() => { fetchItems(); }, []);

  const openCreate = () => {
    setEditItem(null);
    setTitle("");
    setCategory("faq");
    setContent("");
    setIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (item: KnowledgeItem) => {
    setEditItem(item);
    setTitle(item.title);
    setCategory(item.category);
    setContent(item.content);
    setIsActive(item.is_active);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      toast({ title: "Preencha título e conteúdo", variant: "destructive" });
      return;
    }

    if (editItem) {
      const { error } = await supabase
        .from("ai_knowledge_base")
        .update({ title, category, content, is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", editItem.id);
      if (error) {
        toast({ title: "Erro ao salvar", variant: "destructive" });
        return;
      }
      toast({ title: "Atualizado!" });
    } else {
      const { error } = await supabase
        .from("ai_knowledge_base")
        .insert({ title, category, content, is_active: isActive });
      if (error) {
        toast({ title: "Erro ao criar", variant: "destructive" });
        return;
      }
      toast({ title: "Criado!" });
    }
    setDialogOpen(false);
    fetchItems();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("ai_knowledge_base").delete().eq("id", id);
    if (!error) {
      toast({ title: "Removido!" });
      fetchItems();
    }
  };

  const toggleActive = async (item: KnowledgeItem) => {
    await supabase
      .from("ai_knowledge_base")
      .update({ is_active: !item.is_active, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    fetchItems();
  };

  const filtered = filterCategory === "all" ? items : items.filter(i => i.category === filterCategory);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Base de Conhecimento — Livete IA</h2>
          <Badge variant="secondary">{items.filter(i => i.is_active).length} ativos</Badge>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Estes dados são injetados no prompt da Livete para que ela responda corretamente sobre frete, lojas, horários, etc.
      </p>

      <div className="flex gap-2 flex-wrap">
        <Badge
          variant={filterCategory === "all" ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => setFilterCategory("all")}
        >
          Todos ({items.length})
        </Badge>
        {CATEGORIES.map(cat => {
          const count = items.filter(i => i.category === cat.value).length;
          return (
            <Badge
              key={cat.value}
              variant={filterCategory === cat.value ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setFilterCategory(cat.value)}
            >
              {cat.label} ({count})
            </Badge>
          );
        })}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhum item encontrado. Clique em "Adicionar" para criar.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(item => {
            const Icon = getCategoryIcon(item.category);
            return (
              <Card key={item.id} className={!item.is_active ? "opacity-50" : ""}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Icon className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{item.title}</span>
                          <Badge variant="outline" className="text-xs">{getCategoryLabel(item.category)}</Badge>
                          {!item.is_active && <Badge variant="secondary" className="text-xs">Inativo</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{item.content}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={item.is_active}
                        onCheckedChange={() => toggleActive(item)}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(item.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? "Editar" : "Novo"} item de conhecimento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Título</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Valor do frete para SP" />
            </div>
            <div>
              <Label>Conteúdo</Label>
              <Textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Informação que a Livete deve saber..."
                rows={6}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>Ativo</Label>
            </div>
            <Button onClick={handleSave} className="w-full">
              {editItem ? "Salvar" : "Criar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
