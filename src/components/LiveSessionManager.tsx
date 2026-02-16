import { useState, useEffect } from "react";
import { Plus, Trash2, Video, Radio, Search, Check, X, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { toast } from "sonner";

interface LiveSession {
  id: string;
  title: string;
  youtube_video_id: string | null;
  whatsapp_link: string | null;
  is_active: boolean;
  selected_products: ProductRef[];
  created_at: string;
}

interface ProductRef {
  handle: string;
  title: string;
  image?: string;
  price: number;
}

export function LiveSessionManager() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form
  const [title, setTitle] = useState("");
  const [videoId, setVideoId] = useState("");
  const [whatsappLink, setWhatsappLink] = useState("");

  // Product picker
  const [allProducts, setAllProducts] = useState<ShopifyProduct[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<ProductRef[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    const { data } = await supabase
      .from("live_sessions")
      .select("*")
      .order("created_at", { ascending: false });
    setSessions((data as any[]) || []);
    setLoading(false);
  };

  const loadProducts = async () => {
    if (allProducts.length > 0) return;
    setLoadingProducts(true);
    const prods = await fetchProducts(250);
    setAllProducts(prods);
    setLoadingProducts(false);
  };

  const openPicker = () => {
    loadProducts();
    setPickerOpen(true);
  };

  const toggleProduct = (p: ShopifyProduct) => {
    const ref: ProductRef = {
      handle: p.node.handle,
      title: p.node.title,
      image: p.node.images.edges[0]?.node.url,
      price: parseFloat(p.node.priceRange.minVariantPrice.amount),
    };
    setSelectedProducts(prev => {
      const exists = prev.find(x => x.handle === ref.handle);
      if (exists) return prev.filter(x => x.handle !== ref.handle);
      return [...prev, ref];
    });
  };

  const isSelected = (handle: string) => selectedProducts.some(p => p.handle === handle);

  const resetForm = () => {
    setTitle("");
    setVideoId("");
    setWhatsappLink("");
    setSelectedProducts([]);
    setEditingId(null);
  };

  const handleEdit = (s: LiveSession) => {
    setEditingId(s.id);
    setTitle(s.title);
    setVideoId(s.youtube_video_id || "");
    setWhatsappLink(s.whatsapp_link || "");
    setSelectedProducts(s.selected_products || []);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim()) return;

    const payload = {
      title,
      youtube_video_id: videoId || null,
      whatsapp_link: whatsappLink || null,
      selected_products: selectedProducts as any,
    };

    if (editingId) {
      await supabase.from("live_sessions").update(payload).eq("id", editingId);
    } else {
      await supabase.from("live_sessions").insert(payload);
    }

    toast.success(editingId ? "Sessão atualizada!" : "Sessão criada!");
    setDialogOpen(false);
    resetForm();
    fetchSessions();
  };

  const toggleActive = async (id: string, active: boolean) => {
    // Deactivate all others first if activating
    if (active) {
      await supabase.from("live_sessions").update({ is_active: false }).neq("id", id);
    }
    await supabase.from("live_sessions").update({ is_active: active }).eq("id", id);
    toast.success(active ? "Live ativada!" : "Live desativada!");
    fetchSessions();
  };

  const deleteSession = async (id: string) => {
    await supabase.from("live_sessions").delete().eq("id", id);
    toast.success("Sessão removida!");
    fetchSessions();
  };

  const getLiveUrl = (s: LiveSession) => {
    const base = window.location.origin;
    return `${base}/live`;
  };

  const copyUrl = (s: LiveSession) => {
    navigator.clipboard.writeText(getLiveUrl(s));
    toast.success("Link copiado!");
  };

  const filteredProducts = allProducts.filter(p =>
    p.node.title.toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Video className="w-5 h-5" />
          Live Commerce
        </h2>
        <Dialog open={dialogOpen} onOpenChange={o => { setDialogOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="w-4 h-4" /> Nova Sessão
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar" : "Nova"} Sessão de Live</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Título *</Label>
                <Input placeholder="Ex: Live de Verão" value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>ID do Vídeo YouTube</Label>
                <Input placeholder="Ex: dQw4w9WgXcQ" value={videoId} onChange={e => setVideoId(e.target.value)} />
                <p className="text-xs text-muted-foreground">Copie o ID da URL do vídeo (depois do v=)</p>
              </div>
              <div className="space-y-2">
                <Label>Link WhatsApp</Label>
                <Input placeholder="https://wa.me/55..." value={whatsappLink} onChange={e => setWhatsappLink(e.target.value)} />
              </div>

              {/* Selected Products */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Produtos ({selectedProducts.length})</Label>
                  <Button size="sm" variant="outline" onClick={openPicker} className="gap-1">
                    <Plus className="w-3 h-3" /> Adicionar
                  </Button>
                </div>
                {selectedProducts.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {selectedProducts.map(p => (
                      <div key={p.handle} className="flex items-center gap-2 bg-muted rounded-lg px-2 py-1.5">
                        {p.image && <img src={p.image} className="w-8 h-8 rounded object-cover" />}
                        <span className="text-xs flex-1 truncate">{p.title}</span>
                        <button onClick={() => setSelectedProducts(prev => prev.filter(x => x.handle !== p.handle))}
                          className="text-muted-foreground hover:text-destructive">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancelar</Button>
                <Button className="flex-1" onClick={handleSave} disabled={!title.trim()}>Salvar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Product Picker Dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Selecionar Produtos</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar produto..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
          </div>
          <div className="max-h-[50vh] overflow-y-auto space-y-1">
            {loadingProducts ? (
              <p className="text-center text-muted-foreground py-8 text-sm">Carregando...</p>
            ) : filteredProducts.map(p => (
              <button key={p.node.id}
                onClick={() => toggleProduct(p)}
                className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${isSelected(p.node.handle) ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted"}`}>
                {p.node.images.edges[0]?.node.url && (
                  <img src={p.node.images.edges[0].node.url} className="w-10 h-10 rounded object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{p.node.title}</p>
                  <p className="text-xs text-muted-foreground">
                    R$ {parseFloat(p.node.priceRange.minVariantPrice.amount).toFixed(2).replace(".", ",")}
                  </p>
                </div>
                {isSelected(p.node.handle) && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
              </button>
            ))}
          </div>
          <Button onClick={() => setPickerOpen(false)}>Confirmar ({selectedProducts.length} selecionados)</Button>
        </DialogContent>
      </Dialog>

      {/* Sessions List */}
      {loading ? (
        <p className="text-muted-foreground text-sm">Carregando...</p>
      ) : sessions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-8">
            <Video className="w-10 h-10 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma sessão de live criada</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => (
            <Card key={s.id} className={s.is_active ? "ring-2 ring-green-500" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {s.is_active && <Radio className="w-4 h-4 text-green-500 animate-pulse" />}
                    <CardTitle className="text-sm">{s.title}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={s.is_active} onCheckedChange={v => toggleActive(s.id, v)} />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(s)}>
                      <Video className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteSession(s.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{s.selected_products?.length || 0} produtos</span>
                  {s.youtube_video_id && <span>• YouTube: {s.youtube_video_id}</span>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => copyUrl(s)}>
                    <Copy className="w-3 h-3" /> Copiar Link
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1 text-xs" asChild>
                    <a href={getLiveUrl(s)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3" /> Abrir
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
