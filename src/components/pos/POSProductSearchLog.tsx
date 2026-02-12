import { useState, useEffect } from "react";
import { Search, Plus, Trash2, Download, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  storeId: string;
}

interface ProductSearch {
  id: string;
  product_description: string;
  category: string | null;
  brand: string | null;
  size: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  searched_at: string;
  created_by: string | null;
}

const CATEGORIES = ["Masculino", "Feminino", "Infantil", "Unissex", "Acessórios", "Ortopédico", "Outro"];

export function POSProductSearchLog({ storeId }: Props) {
  const [searches, setSearches] = useState<ProductSearch[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [form, setForm] = useState({
    product_description: "",
    category: "",
    brand: "",
    size: "",
    customer_name: "",
    customer_phone: "",
    notes: "",
  });

  useEffect(() => {
    loadSearches();
  }, [storeId]);

  const loadSearches = async () => {
    const { data } = await supabase
      .from("pos_product_searches")
      .select("*")
      .eq("store_id", storeId)
      .order("searched_at", { ascending: false })
      .limit(200);
    if (data) setSearches(data as ProductSearch[]);
  };

  const handleSubmit = async () => {
    if (!form.product_description.trim()) {
      toast.error("Descreva o produto procurado");
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const createdBy = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Desconhecido";

    const { error } = await supabase.from("pos_product_searches").insert({
      store_id: storeId,
      product_description: form.product_description.trim(),
      category: form.category || null,
      brand: form.brand.trim() || null,
      size: form.size.trim() || null,
      customer_name: form.customer_name.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      notes: form.notes.trim() || null,
      created_by: createdBy,
    });

    if (error) {
      toast.error("Erro ao registrar");
      return;
    }

    toast.success("Produto procurado registrado!");
    setForm({ product_description: "", category: "", brand: "", size: "", customer_name: "", customer_phone: "", notes: "" });
    setIsDialogOpen(false);
    loadSearches();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("pos_product_searches").delete().eq("id", id);
    toast.success("Registro removido");
    loadSearches();
  };

  const exportReport = () => {
    const filtered = getFiltered();
    // Count by category
    const categoryCounts: Record<string, number> = {};
    const productCounts: Record<string, number> = {};
    filtered.forEach((s) => {
      const cat = s.category || "Sem categoria";
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      productCounts[s.product_description] = (productCounts[s.product_description] || 0) + 1;
    });

    const sortedProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]);

    let csv = "Produto,Categoria,Marca,Tamanho,Cliente,Telefone,Data,Registrado por\n";
    filtered.forEach((s) => {
      csv += `"${s.product_description}","${s.category || ''}","${s.brand || ''}","${s.size || ''}","${s.customer_name || ''}","${s.customer_phone || ''}","${format(new Date(s.searched_at), 'dd/MM/yyyy HH:mm')}","${s.created_by || ''}"\n`;
    });

    csv += "\n\nResumo por Categoria\nCategoria,Quantidade\n";
    Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
      csv += `"${cat}",${count}\n`;
    });

    csv += "\n\nTop Produtos Mais Procurados\nProduto,Vezes Procurado\n";
    sortedProducts.slice(0, 20).forEach(([prod, count]) => {
      csv += `"${prod}",${count}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `produtos-procurados-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Relatório exportado!");
  };

  const getFiltered = () => {
    return searches.filter((s) => {
      const matchText = !filter || s.product_description.toLowerCase().includes(filter.toLowerCase()) || (s.brand || "").toLowerCase().includes(filter.toLowerCase());
      const matchCat = categoryFilter === "all" || s.category === categoryFilter;
      return matchText && matchCat;
    });
  };

  const filtered = getFiltered();

  // Stats
  const categoryCounts: Record<string, number> = {};
  searches.forEach((s) => {
    const cat = s.category || "Sem categoria";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="flex-1 p-4 overflow-auto" style={{ color: 'hsl(var(--pos-white))' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Produtos Procurados</h2>
          <p className="text-xs text-muted-foreground">Registre produtos que clientes procuraram e não encontraram</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportReport} className="gap-1">
            <Download className="h-3.5 w-3.5" /> Relatório
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1 bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted">
                <Plus className="h-3.5 w-3.5" /> Registrar
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Registrar Produto Procurado</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Produto *</Label>
                  <Input
                    placeholder="Ex: Tênis Nike Air Max preto"
                    value={form.product_description}
                    onChange={(e) => setForm({ ...form, product_description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Categoria</Label>
                    <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Marca</Label>
                    <Input placeholder="Ex: Nike" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Tamanho</Label>
                    <Input placeholder="Ex: 42" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
                  </div>
                  <div>
                    <Label>Nome do Cliente</Label>
                    <Input placeholder="Opcional" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>WhatsApp do Cliente</Label>
                  <Input placeholder="Opcional" value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} />
                </div>
                <div>
                  <Label>Observações</Label>
                  <Textarea placeholder="Detalhes adicionais..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>
                <Button onClick={handleSubmit} className="w-full bg-pos-yellow text-pos-black hover:bg-pos-yellow-muted">
                  Registrar Procura
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats cards */}
      {topCategories.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {topCategories.map(([cat, count]) => (
            <div key={cat} className="bg-pos-yellow/10 border border-pos-yellow/20 rounded-lg px-3 py-1.5">
              <span className="text-xs font-bold" style={{ color: 'hsl(var(--pos-yellow))' }}>{count}x</span>
              <span className="text-xs ml-1 text-muted-foreground">{cat}</span>
            </div>
          ))}
          <div className="bg-muted/30 border border-border rounded-lg px-3 py-1.5">
            <span className="text-xs font-bold">{searches.length}</span>
            <span className="text-xs ml-1 text-muted-foreground">Total</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar produto ou marca..." value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nenhum registro ainda</p>
            <p className="text-xs">Clique em "Registrar" para anotar um produto procurado</p>
          </div>
        )}
        {filtered.map((s) => (
          <div key={s.id} className="bg-card border border-border rounded-lg p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm truncate">{s.product_description}</span>
                {s.category && <Badge variant="secondary" className="text-[10px]">{s.category}</Badge>}
                {s.size && <Badge variant="outline" className="text-[10px]">Tam: {s.size}</Badge>}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {s.brand && <span>Marca: {s.brand}</span>}
                {s.customer_name && <span>Cliente: {s.customer_name}</span>}
                {s.created_by && <span>Por: {s.created_by}</span>}
                <span>{format(new Date(s.searched_at), "dd/MM HH:mm", { locale: ptBR })}</span>
              </div>
              {s.notes && <p className="text-[11px] text-muted-foreground mt-1 italic">{s.notes}</p>}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/60 hover:text-destructive" onClick={() => handleDelete(s.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
