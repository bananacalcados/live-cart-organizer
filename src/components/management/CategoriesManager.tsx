import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown, FolderTree } from "lucide-react";

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  type: "income" | "expense";
  is_active: boolean;
  is_custom: boolean;
}

export function CategoriesManager() {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id?: string; name: string; type: "income" | "expense"; parent_id: string | null } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("financial_categories").select("*").order("type").order("name");
    setCats((data as Category[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const roots = (type: "income" | "expense") => cats.filter((c) => c.type === type && !c.parent_id);
  const children = (id: string) => cats.filter((c) => c.parent_id === id);

  const toggle = (id: string) => {
    const n = new Set(expanded);
    n.has(id) ? n.delete(id) : n.add(id);
    setExpanded(n);
  };

  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    if (editing.id) {
      const { error } = await supabase.from("financial_categories")
        .update({ name: editing.name, parent_id: editing.parent_id, type: editing.type })
        .eq("id", editing.id);
      if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      const { error } = await supabase.from("financial_categories").insert({
        name: editing.name, parent_id: editing.parent_id, type: editing.type, is_active: true, is_custom: true,
      });
      if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
    toast({ title: "Salvo" });
    setEditing(null);
    load();
  };

  const toggleActive = async (c: Category) => {
    await supabase.from("financial_categories").update({ is_active: !c.is_active }).eq("id", c.id);
    load();
  };

  const del = async (c: Category) => {
    if (!confirm(`Excluir categoria "${c.name}"? Lançamentos existentes ficarão sem categoria.`)) return;
    const { error } = await supabase.from("financial_categories").delete().eq("id", c.id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Excluída" });
    load();
  };

  const renderNode = (c: Category, level = 0) => {
    const kids = children(c.id);
    const open = expanded.has(c.id);
    return (
      <div key={c.id}>
        <div
          className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 ${!c.is_active ? "opacity-50" : ""}`}
          style={{ paddingLeft: 8 + level * 20 }}
        >
          {kids.length > 0 ? (
            <button onClick={() => toggle(c.id)} className="text-muted-foreground">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : <div className="w-4" />}
          <span className="flex-1 text-sm">{c.name}</span>
          {c.is_custom && <Badge variant="outline" className="text-[10px]">custom</Badge>}
          {!c.is_active && <Badge variant="secondary" className="text-[10px]">inativa</Badge>}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
            onClick={() => setEditing({ id: undefined, name: "", type: c.type, parent_id: c.id })}
            title="Adicionar subcategoria">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
            onClick={() => setEditing({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id })}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => toggleActive(c)}>
            <Badge variant={c.is_active ? "default" : "outline"} className="text-[10px] cursor-pointer">
              {c.is_active ? "on" : "off"}
            </Badge>
          </Button>
          {c.is_custom && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => del(c)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {open && kids.map((k) => renderNode(k, level + 1))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FolderTree className="h-4 w-4" /> Plano de Contas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setEditing({ name: "", type: "income", parent_id: null })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Nova Entrada
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing({ name: "", type: "expense", parent_id: null })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Nova Saída
          </Button>
        </div>

        {editing && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="text-xs font-medium">{editing.id ? "Editar" : "Nova categoria"}</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input placeholder="Nome" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <Select value={editing.type} onValueChange={(v: any) => setEditing({ ...editing, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Entrada</SelectItem>
                  <SelectItem value="expense">Saída</SelectItem>
                </SelectContent>
              </Select>
              <Select value={editing.parent_id || "__none__"} onValueChange={(v) => setEditing({ ...editing, parent_id: v === "__none__" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Categoria pai" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Raiz —</SelectItem>
                  {cats.filter((c) => c.type === editing.type && !c.parent_id).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>Salvar</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            </div>
          </div>
        )}

        {loading && <div className="text-sm text-muted-foreground">Carregando…</div>}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-emerald-600 uppercase mb-1 px-2">Entradas</div>
              <div className="border rounded-md py-1">{roots("income").map((c) => renderNode(c))}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-destructive uppercase mb-1 px-2">Saídas</div>
              <div className="border rounded-md py-1">{roots("expense").map((c) => renderNode(c))}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
