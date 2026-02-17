import { useState, useEffect } from "react";
import { Plus, Trash2, Video, Radio, Search, Check, X, Copy, ExternalLink, Users, MessageCircle, ShoppingCart, Ban, Send, Eye, Truck, Settings, Star, StarOff, DollarSign, TestTube2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  spotlight_products: ProductRef[];
  freight_config: any;
  created_at: string;
}

interface ProductRef {
  handle: string;
  title: string;
  image?: string;
  price: number;
}

interface LiveViewer {
  id: string;
  name: string;
  phone: string;
  is_online: boolean;
  is_banned: boolean;
  cart_items: any[];
  messages_count: number;
  joined_at: string;
  last_seen_at: string;
}

interface ChatMsg {
  id: string;
  viewer_name: string;
  viewer_phone: string;
  message: string;
  message_type: string;
  created_at: string;
}

// ---- TEST SIMULATION HELPERS ----
const FAKE_NAMES = ["Ana Silva", "Bruno Costa", "Camila Santos", "Diego Oliveira", "Fernanda Lima", "Gabriel Rocha", "Helena Souza", "Igor Mendes"];
const FAKE_MESSAGES = ["Amei! 😍", "Quanto custa?", "Tem na cor preta?", "Quero!", "Lindo demais!", "Qual tamanho?", "Entrega pra SP?", "Pix tem desconto?", "Quero 2!", "Esse é perfeito ❤️"];

function randomItem<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randomPhone() { return `5511${Math.floor(900000000 + Math.random() * 99999999)}`; }

export function LiveSessionManager() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adminSessionId, setAdminSessionId] = useState<string | null>(null);

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

  // Admin state
  const [viewers, setViewers] = useState<LiveViewer[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [adminChatInput, setAdminChatInput] = useState("");
  const [adminTab, setAdminTab] = useState("dashboard");
  const [spotlightProducts, setSpotlightProducts] = useState<ProductRef[]>([]);
  const [freightConfig, setFreightConfig] = useState<any>({ free_above: null, flat_rate: null, enabled: false });

  // Test mode
  const [testRunning, setTestRunning] = useState(false);
  const [testInterval, setTestIntervalState] = useState<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { fetchSessions(); }, []);

  const fetchSessions = async () => {
    const { data } = await supabase.from("live_sessions").select("*").order("created_at", { ascending: false });
    setSessions((data as any[])?.map(s => ({ ...s, spotlight_products: s.spotlight_products || [], freight_config: s.freight_config || { free_above: null, flat_rate: null, enabled: false } })) || []);
    setLoading(false);
  };

  const loadProducts = async () => {
    if (allProducts.length > 0) return;
    setLoadingProducts(true);
    const prods = await fetchProducts(250);
    setAllProducts(prods);
    setLoadingProducts(false);
  };

  const openPicker = () => { loadProducts(); setPickerOpen(true); };

  const toggleProduct = (p: ShopifyProduct) => {
    const ref: ProductRef = { handle: p.node.handle, title: p.node.title, image: p.node.images.edges[0]?.node.url, price: parseFloat(p.node.priceRange.minVariantPrice.amount) };
    setSelectedProducts(prev => prev.find(x => x.handle === ref.handle) ? prev.filter(x => x.handle !== ref.handle) : [...prev, ref]);
  };

  const isSelected = (handle: string) => selectedProducts.some(p => p.handle === handle);

  const resetForm = () => { setTitle(""); setVideoId(""); setWhatsappLink(""); setSelectedProducts([]); setEditingId(null); };

  const handleEdit = (s: LiveSession) => {
    setEditingId(s.id); setTitle(s.title); setVideoId(s.youtube_video_id || ""); setWhatsappLink(s.whatsapp_link || "");
    setSelectedProducts(s.selected_products || []); setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    const payload = { title, youtube_video_id: videoId || null, whatsapp_link: whatsappLink || null, selected_products: selectedProducts as any };
    if (editingId) await supabase.from("live_sessions").update(payload).eq("id", editingId);
    else await supabase.from("live_sessions").insert(payload);
    toast.success(editingId ? "Sessão atualizada!" : "Sessão criada!");
    setDialogOpen(false); resetForm(); fetchSessions();
  };

  const toggleActive = async (id: string, active: boolean) => {
    if (active) await supabase.from("live_sessions").update({ is_active: false }).neq("id", id);
    await supabase.from("live_sessions").update({ is_active: active }).eq("id", id);
    toast.success(active ? "Live ativada!" : "Live desativada!"); fetchSessions();
  };

  const deleteSession = async (id: string) => {
    await supabase.from("live_sessions").delete().eq("id", id);
    toast.success("Sessão removida!"); fetchSessions();
  };

  const getLiveUrl = () => `${window.location.origin}/live`;
  const copyUrl = () => { navigator.clipboard.writeText(getLiveUrl()); toast.success("Link copiado!"); };

  const filteredProducts = allProducts.filter(p => p.node.title.toLowerCase().includes(productSearch.toLowerCase()));

  // ---- REVENUE CALCULATIONS ----
  const getRevenueStats = () => {
    const viewersWithCarts = viewers.filter(v => v.cart_items && (v.cart_items as any[]).length > 0);
    const totalCartValue = viewersWithCarts.reduce((sum, v) => {
      return sum + (v.cart_items as any[]).reduce((s: number, item: any) => s + (item.price || 0) * (item.quantity || 1), 0);
    }, 0);
    const totalItems = viewersWithCarts.reduce((sum, v) => {
      return sum + (v.cart_items as any[]).reduce((s: number, item: any) => s + (item.quantity || 1), 0);
    }, 0);
    return {
      totalCartValue,
      totalItems,
      cartsCount: viewersWithCarts.length,
      leadsCount: viewers.length,
      onlineCount: viewers.filter(v => v.is_online && !v.is_banned).length,
      messagesCount: chatMessages.length,
    };
  };

  // ---- ADMIN PANEL ----
  const openAdmin = (s: LiveSession) => {
    setAdminSessionId(s.id);
    setSpotlightProducts(s.spotlight_products || []);
    setFreightConfig(s.freight_config || { free_above: null, flat_rate: null, enabled: false });
    loadProducts();
    loadAdminData(s.id);
  };

  const loadAdminData = async (sessionId: string) => {
    const [viewersRes, chatRes] = await Promise.all([
      supabase.from("live_viewers").select("*").eq("session_id", sessionId).order("joined_at", { ascending: false }),
      supabase.from("live_chat_messages").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }).limit(200),
    ]);
    setViewers((viewersRes.data as any[]) || []);
    setChatMessages((chatRes.data as any[]) || []);
  };

  // Realtime subscriptions for admin
  useEffect(() => {
    if (!adminSessionId) return;
    const ch1 = supabase.channel(`admin-chat-${adminSessionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_chat_messages", filter: `session_id=eq.${adminSessionId}` }, (p) => {
        setChatMessages(prev => [...prev.slice(-199), p.new as ChatMsg]);
      }).subscribe();
    const ch2 = supabase.channel(`admin-viewers-${adminSessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_viewers", filter: `session_id=eq.${adminSessionId}` }, () => {
        loadAdminData(adminSessionId);
      }).subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, [adminSessionId]);

  const toggleSpotlight = async (product: ProductRef) => {
    const exists = spotlightProducts.find(p => p.handle === product.handle);
    const newSpotlight = exists ? spotlightProducts.filter(p => p.handle !== product.handle) : [...spotlightProducts, product];
    setSpotlightProducts(newSpotlight);
    await supabase.from("live_sessions").update({ spotlight_products: newSpotlight as any }).eq("id", adminSessionId!);
    toast.success(exists ? `${product.title} removido do destaque` : `${product.title} em destaque! 🔥`);
  };

  const isSpotlight = (handle: string) => spotlightProducts.some(p => p.handle === handle);

  const banViewer = async (viewerId: string, banned: boolean) => {
    await supabase.from("live_viewers").update({ is_banned: banned }).eq("id", viewerId);
    toast.success(banned ? "Viewer banido" : "Ban removido");
    loadAdminData(adminSessionId!);
  };

  const sendAdminMessage = async () => {
    if (!adminChatInput.trim() || !adminSessionId) return;
    await supabase.from("live_chat_messages").insert({
      session_id: adminSessionId, viewer_name: "🏪 Banana Calçados", viewer_phone: "admin",
      message: adminChatInput.trim(), message_type: "text",
    });
    setAdminChatInput("");
  };

  const deleteMessage = async (msgId: string) => {
    await supabase.from("live_chat_messages").delete().eq("id", msgId);
    setChatMessages(prev => prev.filter(m => m.id !== msgId));
    toast.success("Mensagem removida");
  };

  const saveFreightConfig = async () => {
    await supabase.from("live_sessions").update({ freight_config: freightConfig as any }).eq("id", adminSessionId!);
    toast.success("Frete atualizado!");
  };

  // ---- TEST MODE ----
  const startTestMode = async () => {
    if (!adminSessionId) return;
    setTestRunning(true);
    toast.success("🧪 Modo teste iniciado! Simulando viewers e mensagens...");

    const sessionProducts = spotlightProducts.length > 0 ? spotlightProducts : (adminSession?.selected_products || []);

    // Create initial batch of fake viewers
    const initialViewers = FAKE_NAMES.slice(0, 4).map(name => ({
      session_id: adminSessionId,
      name,
      phone: randomPhone(),
      is_online: true,
      last_seen_at: new Date().toISOString(),
      messages_count: 0,
      cart_items: [] as any,
    }));
    await supabase.from("live_viewers").upsert(initialViewers, { onConflict: "session_id,phone" });

    // System messages for joining
    const joinMsgs = initialViewers.map(v => ({
      session_id: adminSessionId,
      viewer_name: v.name,
      viewer_phone: v.phone,
      message: `${v.name} entrou na live! 🎉`,
      message_type: "system",
    }));
    await supabase.from("live_chat_messages").insert(joinMsgs);

    // Start interval for ongoing simulation
    const interval = setInterval(async () => {
      const action = Math.random();

      if (action < 0.5) {
        // Send a chat message from a random viewer
        const { data: activeViewers } = await supabase.from("live_viewers").select("name, phone").eq("session_id", adminSessionId).eq("is_online", true).limit(20);
        if (activeViewers && activeViewers.length > 0) {
          const v = randomItem(activeViewers);
          await supabase.from("live_chat_messages").insert({
            session_id: adminSessionId,
            viewer_name: v.name,
            viewer_phone: v.phone,
            message: randomItem(FAKE_MESSAGES),
            message_type: "text",
          });
        }
      } else if (action < 0.75 && sessionProducts.length > 0) {
        // Add a product to a random viewer's cart
        const { data: activeViewers } = await supabase.from("live_viewers").select("*").eq("session_id", adminSessionId).eq("is_online", true).limit(20);
        if (activeViewers && activeViewers.length > 0) {
          const v = randomItem(activeViewers) as any;
          const product = randomItem(sessionProducts);
          const existingCart = Array.isArray(v.cart_items) ? v.cart_items : [];
          const existingItem = existingCart.find((i: any) => i.handle === product.handle);
          let newCart;
          if (existingItem) {
            newCart = existingCart.map((i: any) => i.handle === product.handle ? { ...i, quantity: (i.quantity || 1) + 1 } : i);
          } else {
            newCart = [...existingCart, { handle: product.handle, productTitle: product.title, price: product.price, quantity: 1, image: product.image }];
          }
          await supabase.from("live_viewers").update({ cart_items: newCart as any }).eq("id", v.id);
        }
      } else if (action < 0.9) {
        // New viewer joins
        const name = `${randomItem(FAKE_NAMES)} ${Math.floor(Math.random() * 99)}`;
        const phone = randomPhone();
        await supabase.from("live_viewers").upsert({ session_id: adminSessionId, name, phone, is_online: true, last_seen_at: new Date().toISOString(), messages_count: 0, cart_items: [] as any }, { onConflict: "session_id,phone" });
        await supabase.from("live_chat_messages").insert({ session_id: adminSessionId, viewer_name: name, viewer_phone: phone, message: `${name} entrou na live! 🎉`, message_type: "system" });
      }
    }, 2500);

    setTestIntervalState(interval);
  };

  const stopTestMode = async () => {
    if (testInterval) { clearInterval(testInterval); setTestIntervalState(null); }
    setTestRunning(false);
    toast.success("🧪 Modo teste finalizado!");
  };

  const clearTestData = async () => {
    if (!adminSessionId) return;
    // Remove fake viewers (phones starting with 5511 and 12 digits)
    await supabase.from("live_chat_messages").delete().eq("session_id", adminSessionId);
    await supabase.from("live_viewers").delete().eq("session_id", adminSessionId);
    setChatMessages([]);
    setViewers([]);
    toast.success("Dados de teste limpos!");
  };

  // Cleanup test interval on unmount
  useEffect(() => {
    return () => { if (testInterval) clearInterval(testInterval); };
  }, [testInterval]);

  const adminSession = sessions.find(s => s.id === adminSessionId);
  const onlineViewers = viewers.filter(v => v.is_online && !v.is_banned);
  const stats = getRevenueStats();

  // Admin Panel View
  if (adminSessionId && adminSession) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => { stopTestMode(); setAdminSessionId(null); }}>← Voltar</Button>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Radio className="w-5 h-5 text-green-500 animate-pulse" />
              {adminSession.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {testRunning ? (
              <Button size="sm" variant="destructive" className="gap-1 text-xs" onClick={stopTestMode}>
                <TestTube2 className="w-3 h-3" /> Parar Teste
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={startTestMode}>
                <TestTube2 className="w-3 h-3" /> Modo Teste
              </Button>
            )}
          </div>
        </div>

        {/* Revenue Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          <Card className="border-green-500/20 bg-green-500/5">
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Faturamento Carrinhos</p>
              <p className="text-lg font-bold text-green-500">R$ {stats.totalCartValue.toFixed(2).replace(".", ",")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Carrinhos Ativos</p>
              <p className="text-lg font-bold">{stats.cartsCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Itens nos Carrinhos</p>
              <p className="text-lg font-bold">{stats.totalItems}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Leads Cadastrados</p>
              <p className="text-lg font-bold">{stats.leadsCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Online Agora</p>
              <p className="text-lg font-bold text-green-500">{stats.onlineCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Mensagens</p>
              <p className="text-lg font-bold">{stats.messagesCount}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={adminTab} onValueChange={setAdminTab}>
          <TabsList className="w-full grid grid-cols-6">
            <TabsTrigger value="dashboard" className="gap-1 text-xs"><BarChart3 className="w-3 h-3" /> Dashboard</TabsTrigger>
            <TabsTrigger value="chat" className="gap-1 text-xs"><MessageCircle className="w-3 h-3" /> Chat</TabsTrigger>
            <TabsTrigger value="products" className="gap-1 text-xs"><Star className="w-3 h-3" /> Produtos</TabsTrigger>
            <TabsTrigger value="viewers" className="gap-1 text-xs"><Users className="w-3 h-3" /> Viewers</TabsTrigger>
            <TabsTrigger value="carts" className="gap-1 text-xs"><ShoppingCart className="w-3 h-3" /> Carrinhos</TabsTrigger>
            <TabsTrigger value="config" className="gap-1 text-xs"><Settings className="w-3 h-3" /> Config</TabsTrigger>
          </TabsList>

          {/* DASHBOARD TAB */}
          <TabsContent value="dashboard" className="mt-3 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Top Cart Viewers */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-green-500" /> Maiores Carrinhos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {viewers
                    .filter(v => v.cart_items && (v.cart_items as any[]).length > 0)
                    .sort((a, b) => {
                      const aVal = (a.cart_items as any[]).reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0);
                      const bVal = (b.cart_items as any[]).reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0);
                      return bVal - aVal;
                    })
                    .slice(0, 10)
                    .map(v => {
                      const cartVal = (v.cart_items as any[]).reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0);
                      const itemCount = (v.cart_items as any[]).reduce((s: number, i: any) => s + (i.quantity || 1), 0);
                      return (
                        <div key={v.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${v.is_online ? "bg-green-500" : "bg-zinc-400"}`} />
                            <div>
                              <p className="text-sm font-medium">{v.name}</p>
                              <p className="text-[10px] text-muted-foreground">{itemCount} itens</p>
                            </div>
                          </div>
                          <span className="text-sm font-bold text-green-500">R$ {cartVal.toFixed(2).replace(".", ",")}</span>
                        </div>
                      );
                    })}
                  {viewers.filter(v => v.cart_items && (v.cart_items as any[]).length > 0).length === 0 && (
                    <p className="text-muted-foreground text-sm text-center py-4">Nenhum carrinho ativo</p>
                  )}
                </CardContent>
              </Card>

              {/* Recent Activity */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Atividade Recente</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                    {chatMessages.slice(-20).reverse().map(msg => (
                      <div key={msg.id} className="text-xs">
                        {msg.message_type === "system" ? (
                          <p className="text-muted-foreground italic">{msg.message}</p>
                        ) : (
                          <p><span className="font-bold text-primary">{msg.viewer_name}:</span> {msg.message}</p>
                        )}
                      </div>
                    ))}
                    {chatMessages.length === 0 && <p className="text-muted-foreground text-sm text-center py-4">Sem atividade</p>}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Test Mode Controls */}
            <Card className="border-dashed border-amber-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><TestTube2 className="w-4 h-4 text-amber-500" /> Modo de Teste / Ensaio</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Simule viewers, mensagens e carrinhos para testar o funcionamento da live antes dela acontecer. Os dados simulados podem ser limpos a qualquer momento.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {testRunning ? (
                    <Button size="sm" variant="destructive" className="gap-1" onClick={stopTestMode}>
                      <TestTube2 className="w-3.5 h-3.5" /> Parar Simulação
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="gap-1 border-amber-500/50 text-amber-500 hover:bg-amber-500/10" onClick={startTestMode}>
                      <TestTube2 className="w-3.5 h-3.5" /> Iniciar Simulação
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={clearTestData}>
                    <Trash2 className="w-3.5 h-3.5" /> Limpar Dados de Teste
                  </Button>
                </div>
                {testRunning && (
                  <Badge variant="outline" className="border-amber-500/50 text-amber-500 animate-pulse gap-1">
                    <TestTube2 className="w-3 h-3" /> Simulação em andamento...
                  </Badge>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* CHAT TAB */}
          <TabsContent value="chat" className="mt-3">
            <Card>
              <CardContent className="p-0">
                <div className="h-[400px] flex flex-col">
                  <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                    {chatMessages.map(msg => (
                      <div key={msg.id} className="group flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          {msg.message_type === "system" ? (
                            <p className="text-xs text-muted-foreground italic">{msg.message}</p>
                          ) : (
                            <p className="text-sm">
                              <span className="font-bold text-primary">{msg.viewer_name}</span>
                              <span className="ml-1.5">{msg.message}</span>
                            </p>
                          )}
                        </div>
                        <button onClick={() => deleteMessage(msg.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {chatMessages.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">Nenhuma mensagem ainda</p>}
                  </div>
                  <div className="p-3 border-t flex items-center gap-2">
                    <Input value={adminChatInput} onChange={e => setAdminChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") sendAdminMessage(); }}
                      placeholder="Enviar como Banana Calçados..." className="text-sm" />
                    <Button size="sm" onClick={sendAdminMessage} disabled={!adminChatInput.trim()}><Send className="w-4 h-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* PRODUCTS TAB */}
          <TabsContent value="products" className="mt-3 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm">Produtos em Destaque ({spotlightProducts.length})</h3>
                <p className="text-xs text-muted-foreground">Clique na ⭐ para destacar/remover produtos em tempo real</p>
              </div>
            </div>
            {spotlightProducts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {spotlightProducts.map(p => (
                  <Badge key={p.handle} variant="secondary" className="gap-1.5 py-1">
                    {p.image && <img src={p.image} className="w-5 h-5 rounded object-cover" />}
                    <span className="text-xs">{p.title}</span>
                    <button onClick={() => toggleSpotlight(p)}><X className="w-3 h-3" /></button>
                  </Badge>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar produto do catálogo..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[40vh] overflow-y-auto">
              {loadingProducts ? <p className="col-span-full text-center text-muted-foreground py-4 text-sm">Carregando produtos...</p> :
                filteredProducts.slice(0, 50).map(p => (
                  <button key={p.node.id} onClick={() => toggleSpotlight({ handle: p.node.handle, title: p.node.title, image: p.node.images.edges[0]?.node.url, price: parseFloat(p.node.priceRange.minVariantPrice.amount) })}
                    className={`relative rounded-lg border p-2 text-left transition-all ${isSpotlight(p.node.handle) ? "ring-2 ring-amber-500 bg-amber-50 dark:bg-amber-950/30" : "hover:bg-muted"}`}>
                    {p.node.images.edges[0]?.node.url && <img src={p.node.images.edges[0].node.url} className="w-full aspect-square rounded object-cover mb-1.5" />}
                    <p className="text-xs font-medium line-clamp-2">{p.node.title}</p>
                    <p className="text-xs text-muted-foreground">R$ {parseFloat(p.node.priceRange.minVariantPrice.amount).toFixed(2).replace(".", ",")}</p>
                    {isSpotlight(p.node.handle) && <Star className="absolute top-1.5 right-1.5 w-4 h-4 text-amber-500 fill-amber-500" />}
                  </button>
                ))}
            </div>
          </TabsContent>

          {/* VIEWERS TAB */}
          <TabsContent value="viewers" className="mt-3">
            <Card>
              <CardContent className="p-0">
                <div className="max-h-[50vh] overflow-y-auto divide-y">
                  {viewers.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-8">Nenhum viewer cadastrado</p>
                  ) : viewers.map(v => (
                    <div key={v.id} className={`flex items-center gap-3 p-3 ${v.is_banned ? "opacity-50 bg-destructive/5" : ""}`}>
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${v.is_online ? "bg-green-500" : "bg-zinc-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{v.name} {v.is_banned && <Badge variant="destructive" className="text-[10px] ml-1">Banido</Badge>}</p>
                        <p className="text-xs text-muted-foreground">{v.phone} • {v.messages_count || 0} msgs</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <a href={`https://wa.me/${v.phone}`} target="_blank" rel="noopener noreferrer">
                          <Button size="icon" variant="ghost" className="h-7 w-7"><MessageCircle className="w-3.5 h-3.5 text-green-600" /></Button>
                        </a>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => banViewer(v.id, !v.is_banned)}>
                          <Ban className={`w-3.5 h-3.5 ${v.is_banned ? "text-green-600" : "text-destructive"}`} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* CARTS TAB */}
          <TabsContent value="carts" className="mt-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold">Carrinhos Ativos ({stats.cartsCount})</h3>
                  <Badge variant="outline" className="text-green-500 border-green-500/30">
                    Total: R$ {stats.totalCartValue.toFixed(2).replace(".", ",")}
                  </Badge>
                </div>
                {viewers.filter(v => v.cart_items && (v.cart_items as any[]).length > 0).length === 0 ? (
                  <p className="text-muted-foreground text-xs text-center py-4">Nenhum carrinho ativo</p>
                ) : viewers.filter(v => v.cart_items && (v.cart_items as any[]).length > 0).map(v => {
                  const cartVal = (v.cart_items as any[]).reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0);
                  return (
                    <div key={v.id} className="border rounded-lg p-3 mb-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{v.name}</span>
                          <a href={`https://wa.me/${v.phone}`} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:text-green-500">
                            <MessageCircle className="w-3.5 h-3.5" />
                          </a>
                        </div>
                        <Badge variant="outline" className="text-xs text-green-500">R$ {cartVal.toFixed(2).replace(".", ",")}</Badge>
                      </div>
                      {(v.cart_items as any[]).map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                          {item.image && <img src={item.image} className="w-6 h-6 rounded object-cover" />}
                          <span className="flex-1">{item.productTitle}</span>
                          <span>x{item.quantity || 1}</span>
                          <span className="font-medium text-foreground">R$ {((item.price || 0) * (item.quantity || 1)).toFixed(2).replace(".", ",")}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          {/* CONFIG TAB */}
          <TabsContent value="config" className="mt-3 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Truck className="w-4 h-4" /> Configuração de Frete</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Frete habilitado</Label>
                  <Switch checked={freightConfig.enabled} onCheckedChange={v => setFreightConfig({ ...freightConfig, enabled: v })} />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Frete fixo (R$)</Label>
                  <Input type="number" placeholder="Ex: 15.90" value={freightConfig.flat_rate || ""}
                    onChange={e => setFreightConfig({ ...freightConfig, flat_rate: e.target.value ? parseFloat(e.target.value) : null })} />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Frete grátis acima de (R$)</Label>
                  <Input type="number" placeholder="Ex: 200.00" value={freightConfig.free_above || ""}
                    onChange={e => setFreightConfig({ ...freightConfig, free_above: e.target.value ? parseFloat(e.target.value) : null })} />
                </div>
                <Button onClick={saveFreightConfig} className="w-full">Salvar Configuração de Frete</Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Links da Live</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={copyUrl}><Copy className="w-3 h-3" /> Copiar Link</Button>
                  <Button size="sm" variant="outline" className="gap-1 text-xs" asChild>
                    <a href={getLiveUrl()} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3" /> Abrir Live</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // ---- SESSION LIST VIEW ----
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><Video className="w-5 h-5" /> Live Commerce</h2>
        <Dialog open={dialogOpen} onOpenChange={o => { setDialogOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild><Button size="sm" className="gap-1"><Plus className="w-4 h-4" /> Nova Sessão</Button></DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingId ? "Editar" : "Nova"} Sessão de Live</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2"><Label>Título *</Label><Input placeholder="Ex: Live de Verão" value={title} onChange={e => setTitle(e.target.value)} /></div>
              <div className="space-y-2"><Label>ID do Vídeo YouTube</Label><Input placeholder="Ex: dQw4w9WgXcQ" value={videoId} onChange={e => setVideoId(e.target.value)} /><p className="text-xs text-muted-foreground">Copie o ID da URL do vídeo (depois do v=)</p></div>
              <div className="space-y-2"><Label>Link WhatsApp</Label><Input placeholder="https://wa.me/55..." value={whatsappLink} onChange={e => setWhatsappLink(e.target.value)} /></div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Catálogo ({selectedProducts.length})</Label>
                  <Button size="sm" variant="outline" onClick={openPicker} className="gap-1"><Plus className="w-3 h-3" /> Adicionar</Button>
                </div>
                {selectedProducts.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {selectedProducts.map(p => (
                      <div key={p.handle} className="flex items-center gap-2 bg-muted rounded-lg px-2 py-1.5">
                        {p.image && <img src={p.image} className="w-8 h-8 rounded object-cover" />}
                        <span className="text-xs flex-1 truncate">{p.title}</span>
                        <button onClick={() => setSelectedProducts(prev => prev.filter(x => x.handle !== p.handle))} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
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
          <DialogHeader><DialogTitle>Selecionar Produtos</DialogTitle></DialogHeader>
          <div className="relative"><Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" /><Input className="pl-8" placeholder="Buscar produto..." value={productSearch} onChange={e => setProductSearch(e.target.value)} /></div>
          <div className="max-h-[50vh] overflow-y-auto space-y-1">
            {loadingProducts ? <p className="text-center text-muted-foreground py-8 text-sm">Carregando...</p> :
              filteredProducts.map(p => (
                <button key={p.node.id} onClick={() => toggleProduct(p)}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${isSelected(p.node.handle) ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted"}`}>
                  {p.node.images.edges[0]?.node.url && <img src={p.node.images.edges[0].node.url} className="w-10 h-10 rounded object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{p.node.title}</p>
                    <p className="text-xs text-muted-foreground">R$ {parseFloat(p.node.priceRange.minVariantPrice.amount).toFixed(2).replace(".", ",")}</p>
                  </div>
                  {isSelected(p.node.handle) && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                </button>
              ))}
          </div>
          <Button onClick={() => setPickerOpen(false)}>Confirmar ({selectedProducts.length} selecionados)</Button>
        </DialogContent>
      </Dialog>

      {/* Sessions List */}
      {loading ? <p className="text-muted-foreground text-sm">Carregando...</p> : sessions.length === 0 ? (
        <Card className="border-dashed"><CardContent className="flex flex-col items-center py-8"><Video className="w-10 h-10 text-muted-foreground mb-2" /><p className="text-sm text-muted-foreground">Nenhuma sessão de live criada</p></CardContent></Card>
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
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(s)}><Video className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteSession(s.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{s.selected_products?.length || 0} produtos</span>
                  <span>• {(s.spotlight_products || []).length} em destaque</span>
                  {s.youtube_video_id && <span>• YouTube: {s.youtube_video_id}</span>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => copyUrl()}><Copy className="w-3 h-3" /> Copiar Link</Button>
                  <Button size="sm" variant="outline" className="gap-1 text-xs" asChild>
                    <a href={getLiveUrl()} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3" /> Abrir</a>
                  </Button>
                  <Button size="sm" className="gap-1 text-xs" onClick={() => openAdmin(s)}>
                    <Radio className="w-3 h-3" /> Gerenciar Live
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
