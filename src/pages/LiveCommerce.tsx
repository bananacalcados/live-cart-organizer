import { useState, useEffect, useCallback, useRef } from "react";
import { ShoppingBag, MessageCircle, X, Plus, Minus, ShoppingCart, Trash2, Send, Users, PictureInPicture2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { createShopifyCartFromOrder } from "@/lib/shopifyCart";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CartItem {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  price: number;
  quantity: number;
  image?: string;
  handle?: string;
}

interface ProductRef {
  handle: string;
  title: string;
  image?: string;
  price: number;
}

interface LiveSessionData {
  id: string;
  youtube_video_id: string | null;
  whatsapp_link: string | null;
  selected_products: ProductRef[];
  spotlight_products: ProductRef[];
  title: string;
}

const STORAGE_KEY = "live_viewer";
const MIN_PUBLIC_VIEWERS = 200;

const LiveCommerce = () => {
  const [session, setSession] = useState<LiveSessionData | null>(null);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [drawerView, setDrawerView] = useState<"closed" | "products" | "cart" | "chat">("closed");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkingOut, setCheckingOut] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ShopifyProduct | null>(null);
  const [loading, setLoading] = useState(true);

  // Viewer / lead gate state
  const [viewer, setViewer] = useState<{ name: string; phone: string } | null>(null);
  const [showGate, setShowGate] = useState(false);
  const [gatePurpose, setGatePurpose] = useState<"chat" | "cart">("chat");
  const [gateName, setGateName] = useState("");
  const [gatePhone, setGatePhone] = useState("");
  const [viewerCount, setViewerCount] = useState(0);

  // Chat state
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [pipActive, setPipActive] = useState(false);

  // Pending action after gate
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Restore viewer from localStorage (persisted across lives)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) { try { setViewer(JSON.parse(stored)); } catch {} }
  }, []);

  // Fetch active session
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("live_sessions").select("*").eq("is_active", true).limit(1).maybeSingle();
      if (data) {
        const s = data as any;
        setSession({
          id: s.id,
          youtube_video_id: s.youtube_video_id,
          whatsapp_link: s.whatsapp_link,
          selected_products: s.selected_products || [],
          spotlight_products: s.spotlight_products || [],
          title: s.title,
        });
        const spotlightHandles = (s.spotlight_products || []).map((p: ProductRef) => p.handle);
        if (spotlightHandles.length > 0) {
          const allProds = await fetchProducts(250);
          setProducts(allProds.filter(p => spotlightHandles.includes(p.node.handle)));
        }
        const { count } = await supabase
          .from("live_viewers").select("*", { count: "exact", head: true })
          .eq("session_id", s.id).eq("is_online", true);
        setViewerCount(count || 0);

        // Auto-register viewer if already known
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            const v = JSON.parse(stored);
            await supabase.from("live_viewers").upsert(
              { session_id: s.id, name: v.name, phone: v.phone, is_online: true, last_seen_at: new Date().toISOString() },
              { onConflict: "session_id,phone" }
            );
          } catch {}
        }
      }
      setLoading(false);
    };
    load();
  }, []);

  // Realtime: spotlight products + session changes
  useEffect(() => {
    if (!session?.id) return;
    const channel = supabase
      .channel(`live-session-${session.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_sessions", filter: `id=eq.${session.id}` }, async (payload) => {
        const s = payload.new as any;
        const newSpotlight: ProductRef[] = s.spotlight_products || [];
        setSession(prev => prev ? { ...prev, spotlight_products: newSpotlight, selected_products: s.selected_products || prev.selected_products } : prev);
        const handles = newSpotlight.map(p => p.handle);
        if (handles.length > 0) {
          const allProds = await fetchProducts(250);
          setProducts(allProds.filter(p => handles.includes(p.node.handle)));
        } else {
          setProducts([]);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  // Realtime: viewer count
  useEffect(() => {
    if (!session?.id) return;
    const channel = supabase
      .channel(`live-viewers-${session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_viewers", filter: `session_id=eq.${session.id}` }, async () => {
        const { count } = await supabase
          .from("live_viewers").select("*", { count: "exact", head: true })
          .eq("session_id", session.id).eq("is_online", true);
        setViewerCount(count || 0);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  // Realtime: chat messages
  useEffect(() => {
    if (!session?.id) return;
    const loadMsgs = async () => {
      const { data } = await supabase
        .from("live_chat_messages").select("id, viewer_name, message, message_type, created_at")
        .eq("session_id", session.id).order("created_at", { ascending: true }).limit(100);
      if (data) setChatMessages(data);
    };
    loadMsgs();
    const channel = supabase
      .channel(`live-chat-${session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_chat_messages", filter: `session_id=eq.${session.id}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          setChatMessages(prev => [...prev.slice(-99), payload.new]);
        } else if (payload.eventType === "DELETE") {
          setChatMessages(prev => prev.filter((m: any) => m.id !== payload.old.id));
        }
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Gate logic
  const requireViewer = (purpose: "chat" | "cart", action: () => void) => {
    if (viewer) { action(); return; }
    setGatePurpose(purpose);
    setPendingAction(() => action);
    setShowGate(true);
  };

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const handleGateSubmit = async () => {
    const rawPhone = gatePhone.replace(/\D/g, "");
    if (gateName.trim().length < 2 || rawPhone.length < 10) return;
    const phone = `55${rawPhone}`;
    const viewerData = { name: gateName.trim(), phone };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(viewerData));
    setViewer(viewerData);
    setShowGate(false);

    if (session?.id) {
      await supabase.from("live_viewers").upsert(
        { session_id: session.id, name: viewerData.name, phone, is_online: true, last_seen_at: new Date().toISOString() },
        { onConflict: "session_id,phone" }
      );
      await supabase.from("live_chat_messages").insert({
        session_id: session.id, viewer_name: viewerData.name, viewer_phone: phone,
        message: `${viewerData.name} entrou na live! 🎉`, message_type: "system",
      });
    }
    if (pendingAction) { pendingAction(); setPendingAction(null); }
  };

  const isLive = !!session?.youtube_video_id;
  const videoId = session?.youtube_video_id || "";
  const whatsappLink = session?.whatsapp_link || "";

  // Picture-in-Picture toggle
  const togglePiP = useCallback(async () => {
    try {
      // Check if there's already a PiP window
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setPipActive(false);
        return;
      }

      // For YouTube iframes, we need to use the experimental documentPictureInPicture API
      // or fallback to creating a video element from the iframe
      const iframe = videoContainerRef.current?.querySelector("iframe");
      if (!iframe) return;

      // Try Document PiP API (Chrome 116+)
      if ("documentPictureInPicture" in window) {
        const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
          width: 400,
          height: 225,
        });
        const pipDoc = pipWindow.document;
        pipDoc.body.style.margin = "0";
        pipDoc.body.style.overflow = "hidden";
        pipDoc.body.style.background = "#000";
        const pipIframe = pipDoc.createElement("iframe");
        pipIframe.src = iframe.src;
        pipIframe.style.width = "100%";
        pipIframe.style.height = "100%";
        pipIframe.style.border = "none";
        pipIframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        pipDoc.body.appendChild(pipIframe);
        setPipActive(true);
        pipWindow.addEventListener("pagehide", () => setPipActive(false));
        return;
      }

      // Fallback: open in small floating window
      const pipUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
      const pipWin = window.open(pipUrl, "live_pip", "width=400,height=225,top=50,left=" + (screen.width - 420));
      if (pipWin) {
        setPipActive(true);
        const timer = setInterval(() => { if (pipWin.closed) { setPipActive(false); clearInterval(timer); } }, 1000);
      }
    } catch (err) {
      console.error("PiP error:", err);
      // Ultimate fallback: small window
      const pipUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
      window.open(pipUrl, "live_pip", "width=400,height=225,top=50,left=" + (screen.width - 420));
    }
  }, [videoId]);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  // Public viewer count: always show at least MIN_PUBLIC_VIEWERS
  const publicViewerCount = Math.max(viewerCount, MIN_PUBLIC_VIEWERS) + Math.floor(Math.random() * 15);

  const addToCart = useCallback((variant: { id: string; title: string; price: number }, productTitle: string, image?: string) => {
    setCart(prev => {
      const existing = prev.find(i => i.variantId === variant.id);
      if (existing) return prev.map(i => i.variantId === variant.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { variantId: variant.id, productTitle, variantTitle: variant.title === "Default Title" ? "" : variant.title, price: variant.price, quantity: 1, image }];
    });
    toast.success("Adicionado ao carrinho!");
    setSelectedProduct(null);

    // Sync cart to viewer record for admin visibility
    if (viewer && session?.id) {
      setTimeout(async () => {
        // Re-read cart after state update
        const currentCart = [...cart, { variantId: variant.id, productTitle, price: variant.price, quantity: 1, image }];
        const cartItems = currentCart.map(i => ({ handle: i.variantId, productTitle: i.productTitle, price: i.price, quantity: i.quantity, image: i.image }));
        await supabase.from("live_viewers").update({ cart_items: cartItems as any }).eq("session_id", session.id).eq("phone", viewer.phone);
      }, 100);
    }
  }, [cart, viewer, session?.id]);

  const updateQty = (variantId: string, delta: number) => {
    setCart(prev => prev.map(i => { if (i.variantId !== variantId) return i; const q = i.quantity + delta; return q <= 0 ? null! : { ...i, quantity: q }; }).filter(Boolean));
  };

  const removeItem = (variantId: string) => setCart(prev => prev.filter(i => i.variantId !== variantId));

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckingOut(true);
    try {
      const orderProducts = cart.map(item => ({ id: item.variantId, title: item.productTitle, variant: item.variantTitle || "Default", price: item.price, quantity: item.quantity, shopifyId: item.variantId, image: item.image }));
      const checkoutUrl = await createShopifyCartFromOrder(orderProducts);
      if (checkoutUrl) { window.location.href = checkoutUrl; } else { toast.error("Erro ao criar carrinho."); }
    } catch { toast.error("Erro ao processar."); } finally { setCheckingOut(false); }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || sendingChat || !viewer || !session?.id) return;
    setSendingChat(true);
    const text = chatInput.trim();
    setChatInput("");
    await supabase.from("live_chat_messages").insert({ session_id: session.id, viewer_name: viewer.name, viewer_phone: viewer.phone, message: text, message_type: "text" });
    setSendingChat(false);
  };

  const getNameColor = (name: string) => {
    const colors = ["text-amber-400", "text-pink-400", "text-cyan-400", "text-green-400", "text-purple-400", "text-orange-400"];
    let hash = 0; for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  if (loading) return <div className="min-h-screen bg-black text-white flex items-center justify-center"><p className="text-zinc-400">Carregando...</p></div>;

  if (!session) return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-3">
      <ShoppingBag className="w-16 h-16 text-zinc-600" /><p className="text-zinc-400 text-lg font-medium">Nenhuma live no momento</p><p className="text-zinc-500 text-sm">Volte em breve! 🎉</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Lead Gate Modal */}
      {showGate && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center px-4" onClick={() => setShowGate(false)}>
          <div className="bg-zinc-900 rounded-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="text-center space-y-2">
              <img src="/images/banana-logo.png" alt="" className="w-12 h-12 rounded-full mx-auto object-cover" />
              <h3 className="font-bold text-base">
                {gatePurpose === "chat" ? "Cadastre-se para comentar" : "Cadastre-se para comprar"}
              </h3>
              <p className="text-zinc-400 text-xs">Seus dados são protegidos 🔒</p>
            </div>
            <div className="space-y-3">
              <input value={gateName} onChange={e => setGateName(e.target.value)} placeholder="Seu nome"
                className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-amber-500/50" autoFocus />
              <input value={gatePhone} onChange={e => setGatePhone(formatPhone(e.target.value))} placeholder="(11) 99999-9999" inputMode="tel"
                className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-amber-500/50" />
              <Button className="w-full bg-amber-500 hover:bg-amber-600 text-black font-bold" onClick={handleGateSubmit}
                disabled={gateName.trim().length < 2 || gatePhone.replace(/\D/g, "").length < 10}>
                Continuar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Video */}
      <div ref={videoContainerRef} className="relative w-full" style={{ paddingTop: "56.25%" }}>
        {isLive ? (
          <>
            <iframe className="absolute inset-0 w-full h-full"
              src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
              title="Live" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />
            {/* PiP Button */}
            <button
              onClick={togglePiP}
              className={`absolute top-3 right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                pipActive ? "bg-amber-500 text-black" : "bg-black/60 text-white hover:bg-black/80"
              }`}
              title={pipActive ? "Fechar Picture-in-Picture" : "Assistir em miniatura"}
            >
              <PictureInPicture2 className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 gap-3">
            <ShoppingBag className="w-8 h-8 text-zinc-500" /><p className="text-zinc-400">Aguardando transmissão...</p>
          </div>
        )}
      </div>

      {/* Info Bar */}
      <div className="bg-zinc-900 border-t border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/images/banana-logo.png" alt="Banana Calçados" className="w-8 h-8 rounded-full object-cover" loading="lazy" />
          <div>
            <h1 className="text-sm font-bold leading-tight">{session.title}</h1>
            <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
              {isLive && <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> AO VIVO • </>}
              <Users className="w-3 h-3" /> {publicViewerCount}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {whatsappLink && (
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center bg-green-600 hover:bg-green-700 text-white text-[10px] font-semibold px-2 py-1.5 rounded-lg">
              <MessageCircle className="w-3.5 h-3.5" />
            </a>
          )}
          <Button size="sm" variant="outline"
            className={`border-zinc-700 text-white hover:bg-zinc-800 h-8 px-2 text-xs ${drawerView === "chat" ? "bg-zinc-700" : ""}`}
            onClick={() => requireViewer("chat", () => setDrawerView(v => v === "chat" ? "closed" : "chat"))}>
            💬
          </Button>
          {products.length > 0 && (
            <Button size="sm" variant="outline"
              className={`border-zinc-700 text-white hover:bg-zinc-800 gap-1 h-8 px-2 text-xs ${drawerView === "products" ? "bg-zinc-700" : ""}`}
              onClick={() => setDrawerView(v => v === "products" ? "closed" : "products")}>
              <ShoppingBag className="w-3.5 h-3.5" /> {products.length}
            </Button>
          )}
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-black font-bold h-8 px-2 relative"
            onClick={() => setDrawerView(v => v === "cart" ? "closed" : "cart")}>
            <ShoppingCart className="w-3.5 h-3.5" />
            {cartCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{cartCount}</span>}
          </Button>
        </div>
      </div>

      {/* Variant Selector Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setSelectedProduct(null)}>
          <div className="bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-bold text-sm">Escolha o tamanho/cor</h3>
              <button onClick={() => setSelectedProduct(null)} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4">
              <p className="text-xs text-zinc-400 mb-3">{selectedProduct.node.title}</p>
              <div className="grid grid-cols-2 gap-2">
                {selectedProduct.node.variants.edges.filter(v => v.node.availableForSale).map(v => (
                  <button key={v.node.id} className="bg-zinc-800 hover:bg-zinc-700 rounded-lg p-3 text-left transition-colors"
                    onClick={() => requireViewer("cart", () => addToCart({ id: v.node.id, title: v.node.title, price: parseFloat(v.node.price.amount) }, selectedProduct.node.title, selectedProduct.node.images.edges[0]?.node.url))}>
                    <p className="text-xs font-medium">{v.node.title}</p>
                    <p className="text-sm font-bold text-green-400 mt-1">R$ {parseFloat(v.node.price.amount).toFixed(2).replace(".", ",")}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Drawer - with fixed auto-scroll */}
      {drawerView === "chat" && viewer && (
        <div className="bg-zinc-900 border-t border-zinc-800 h-[40vh] flex flex-col">
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 min-h-0">
            {chatMessages.map((msg: any) => (
              <div key={msg.id} className="animate-fade-in">
                {msg.message_type === "system" ? (
                  <p className="text-[11px] text-zinc-500 text-center italic">{msg.message}</p>
                ) : (
                  <p className="text-[12px] leading-tight">
                    <span className={`font-bold ${getNameColor(msg.viewer_name)}`}>{msg.viewer_name}</span>
                    <span className="text-zinc-300 ml-1.5">{msg.message}</span>
                  </p>
                )}
              </div>
            ))}
            {chatMessages.length === 0 && <p className="text-zinc-600 text-xs text-center py-4">Seja o primeiro a comentar! 💬</p>}
          </div>
          <div className="px-3 py-2 border-t border-zinc-800">
            <div className="flex items-center gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") sendChatMessage(); }}
                placeholder="Comente aqui..." maxLength={200}
                className="flex-1 bg-zinc-800 rounded-full px-4 py-2 text-xs text-white placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-amber-500/50" />
              <button onClick={sendChatMessage} disabled={!chatInput.trim() || sendingChat}
                className="w-8 h-8 rounded-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 flex items-center justify-center">
                <Send className="w-3.5 h-3.5 text-black" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Products Drawer */}
      {drawerView === "products" && (
        <div className="bg-zinc-900 border-t border-zinc-800 max-h-[50vh] overflow-y-auto">
          <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800">
            <h2 className="text-sm font-bold">Produtos em Destaque 🔥</h2>
            <button onClick={() => setDrawerView("closed")} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-4">
            {products.map(p => {
              const product = p.node;
              const image = product.images.edges[0]?.node.url;
              const price = parseFloat(product.priceRange.minVariantPrice.amount);
              const hasVariants = product.variants.edges.length > 1;
              return (
                <button key={product.id} className="bg-zinc-800 rounded-lg overflow-hidden hover:ring-1 hover:ring-amber-500/50 transition-all group text-left"
                  onClick={() => {
                    if (hasVariants) { requireViewer("cart", () => setSelectedProduct(p)); }
                    else {
                      const v = product.variants.edges[0]?.node;
                      if (v?.availableForSale) requireViewer("cart", () => addToCart({ id: v.id, title: v.title, price: parseFloat(v.price.amount) }, product.title, image));
                      else toast.error("Produto esgotado");
                    }
                  }}>
                  {image && <div className="aspect-square overflow-hidden"><img src={image} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" /></div>}
                  <div className="p-2">
                    <p className="text-xs font-medium line-clamp-2 leading-tight">{product.title}</p>
                    <p className="text-sm font-bold text-green-400 mt-1">R$ {price.toFixed(2).replace(".", ",")}</p>
                    <span className="text-[10px] text-amber-400 flex items-center gap-1 mt-1"><Plus className="w-3 h-3" /> {hasVariants ? "Escolher tamanho" : "Adicionar"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {drawerView === "cart" && (
        <div className="bg-zinc-900 border-t border-zinc-800 max-h-[50vh] overflow-y-auto">
          <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800">
            <h2 className="text-sm font-bold">Meu Carrinho ({cartCount})</h2>
            <button onClick={() => setDrawerView("closed")} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          {cart.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingCart className="w-10 h-10 text-zinc-600 mx-auto mb-2" /><p className="text-zinc-500 text-sm">Seu carrinho está vazio</p>
              <button className="text-amber-400 text-xs mt-2 underline" onClick={() => setDrawerView("products")}>Ver produtos</button>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {cart.map(item => (
                <div key={item.variantId} className="flex items-center gap-3 bg-zinc-800 rounded-lg p-3">
                  {item.image && <img src={item.image} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.productTitle}</p>
                    {item.variantTitle && <p className="text-[10px] text-zinc-400">{item.variantTitle}</p>}
                    <p className="text-sm font-bold text-green-400">R$ {(item.price * item.quantity).toFixed(2).replace(".", ",")}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQty(item.variantId, -1)} className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                    <span className="text-xs w-6 text-center font-bold">{item.quantity}</span>
                    <button onClick={() => updateQty(item.variantId, 1)} className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                    <button onClick={() => removeItem(item.variantId)} className="w-7 h-7 rounded bg-red-900/50 hover:bg-red-800/50 flex items-center justify-center ml-1"><Trash2 className="w-3 h-3 text-red-400" /></button>
                  </div>
                </div>
              ))}
              <div className="border-t border-zinc-700 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Total</span>
                  <span className="text-lg font-bold text-green-400">R$ {cartTotal.toFixed(2).replace(".", ",")}</span>
                </div>
                <Button className="w-full bg-amber-500 hover:bg-amber-600 text-black font-bold text-sm py-5" onClick={handleCheckout} disabled={checkingOut}>
                  {checkingOut ? "Gerando checkout..." : "Finalizar Compra"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LiveCommerce;
