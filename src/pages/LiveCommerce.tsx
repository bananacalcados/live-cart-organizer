import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ShoppingBag, MessageCircle, X, Plus, Minus, ShoppingCart, Trash2, Send, Users, ChevronUp, Tag, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
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
  overlay_config: any;
}

const STORAGE_KEY = "live_viewer";
const MIN_PUBLIC_VIEWERS = 200;

/** Generate a unique username from the display name + phone suffix */
function generateUsername(name: string, phone: string): string {
  const firstName = name.trim().split(/\s+/)[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const suffix = phone.slice(-4);
  return `${firstName}${suffix}`;
}

/** Extract YouTube video ID from URL or plain ID */
function extractVideoId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!trimmed.includes("/") && !trimmed.includes(".")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.searchParams.has("v")) return url.searchParams.get("v") || "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  } catch {}
  return trimmed;
}

const LiveCommerce = () => {
  const [session, setSession] = useState<LiveSessionData | null>(null);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [drawerView, setDrawerView] = useState<"closed" | "cart">("closed");
  const [cart, setCart] = useState<CartItem[]>(() => {
    // Restore cart from localStorage if returning from checkout
    try {
      const saved = localStorage.getItem("live_cart");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [checkingOut, setCheckingOut] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ShopifyProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProducts, setShowProducts] = useState(true);

  // Viewer / lead gate state
  const [viewer, setViewer] = useState<{ name: string; phone: string; username: string } | null>(null);
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
  const [iframeMuted, setIframeMuted] = useState(true); // iOS requires muted autoplay
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sync cart to localStorage whenever it changes
  useEffect(() => {
    if (cart.length > 0) {
      localStorage.setItem("live_cart", JSON.stringify(cart));
    } else {
      localStorage.removeItem("live_cart");
    }
  }, [cart]);

  // Pending action after gate
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Restore viewer from localStorage (regenerate username if missing)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Fix: old entries may lack username
        if (!parsed.username && parsed.name && parsed.phone) {
          parsed.username = generateUsername(parsed.name, parsed.phone);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
        if (parsed.name && parsed.phone && parsed.username) {
          setViewer(parsed);
        } else {
          // Corrupt data, clear it
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch { localStorage.removeItem(STORAGE_KEY); }
    }
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
          overlay_config: s.overlay_config || {},
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
        setSession(prev => prev ? { ...prev, spotlight_products: newSpotlight, selected_products: s.selected_products || prev.selected_products, overlay_config: s.overlay_config || prev.overlay_config } : prev);
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

  // Auto-scroll chat
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
    const username = generateUsername(gateName, phone);
    const viewerData = { name: gateName.trim(), phone, username };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(viewerData));
    setViewer(viewerData);
    setShowGate(false);

    if (session?.id) {
      await supabase.from("live_viewers").upsert(
        { session_id: session.id, name: viewerData.name, phone, is_online: true, last_seen_at: new Date().toISOString() },
        { onConflict: "session_id,phone" }
      );
      await supabase.from("live_chat_messages").insert({
        session_id: session.id, viewer_name: `@${username}`, viewer_phone: phone,
        message: `${viewerData.name} entrou na live! 🎉`, message_type: "system",
      });
    }
    if (pendingAction) { pendingAction(); setPendingAction(null); }
  };

  const isLive = !!session?.youtube_video_id;
  const videoId = extractVideoId(session?.youtube_video_id || "");
  const whatsappLink = session?.whatsapp_link || "";

  // PiP is no longer used (popup blockers prevent it on mobile)

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const publicViewerCount = Math.max(viewerCount, MIN_PUBLIC_VIEWERS) + Math.floor(Math.random() * 15);

  // Overlay config
  const overlay = session?.overlay_config || {};

  // Countdown timer
  const [countdownText, setCountdownText] = useState("");
  useEffect(() => {
    if (!overlay.show_countdown || !overlay.countdown_end) { setCountdownText(""); return; }
    const update = () => {
      const end = new Date(overlay.countdown_end).getTime();
      const now = Date.now();
      const diff = end - now;
      if (diff <= 0) { setCountdownText("⏰ ENCERRADO!"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdownText(`${h > 0 ? h + "h " : ""}${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [overlay.show_countdown, overlay.countdown_end]);

  const addToCart = useCallback((variant: { id: string; title: string; price: number }, productTitle: string, image?: string) => {
    setCart(prev => {
      const existing = prev.find(i => i.variantId === variant.id);
      if (existing) return prev.map(i => i.variantId === variant.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { variantId: variant.id, productTitle, variantTitle: variant.title === "Default Title" ? "" : variant.title, price: variant.price, quantity: 1, image }];
    });
    toast.success("Adicionado ao carrinho! 🛒");
    setSelectedProduct(null);

    if (viewer && session?.id) {
      setTimeout(async () => {
        const variantTitle = variant.title === "Default Title" ? "" : variant.title;
        const currentCart = [...cart, { variantId: variant.id, productTitle, variantTitle, price: variant.price, quantity: 1, image }];
        const cartItems = currentCart.map(i => ({ handle: i.variantId, variantId: i.variantId, productTitle: i.productTitle, variantTitle: i.variantTitle || "", price: i.price, quantity: i.quantity, image: i.image }));
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
      // Save cart to localStorage for persistence when returning from checkout
      localStorage.setItem("live_cart", JSON.stringify(cart));

      // Save cart to DB for admin visibility / cart recovery
      if (viewer && session?.id) {
        const cartValue = cart.reduce((s, i) => s + i.price * i.quantity, 0);
        await supabase.from("live_viewers").update({
          cart_items: cart as any,
          cart_value: cartValue,
          last_seen_at: new Date().toISOString(),
          checkout_completed: true,
          checkout_completed_at: new Date().toISOString(),
        }).eq("session_id", session.id).eq("phone", viewer.phone);
      }

      const liveCartData = cart.map(item => ({
        title: item.productTitle,
        variant: item.variantTitle || "Único",
        price: item.price,
        quantity: item.quantity,
        image: item.image || "",
      }));
      const payload = JSON.stringify({
        items: liveCartData,
        customer: viewer ? { name: viewer.name, phone: viewer.phone } : null,
        source: "live",
        videoId: videoId || null,
      });
      // Use encodeURIComponent only (btoa can fail with unicode)
      const encoded = encodeURIComponent(payload);
      // Navigate in same tab to avoid popup blockers; pass videoId for mini-player
      const videoParam = videoId ? `&videoId=${encodeURIComponent(videoId)}` : "";
      window.location.href = `/checkout/live?live=${encoded}${videoParam}`;
    } catch (err) {
      console.error("[Live Checkout] Error:", err);
      toast.error("Erro ao processar checkout.");
      setCheckingOut(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || sendingChat || !viewer || !session?.id) return;
    setSendingChat(true);
    const text = chatInput.trim();
    setChatInput("");
    await supabase.from("live_chat_messages").insert({
      session_id: session.id,
      viewer_name: `@${viewer.username}`,
      viewer_phone: viewer.phone,
      message: text,
      message_type: "text",
    });
    setSendingChat(false);
  };

  const getNameColor = (name: string) => {
    const colors = ["text-amber-400", "text-pink-400", "text-cyan-400", "text-green-400", "text-purple-400", "text-orange-400", "text-blue-400", "text-rose-400"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  if (loading) return <div className="h-[100dvh] bg-black text-white flex items-center justify-center"><p className="text-zinc-400">Carregando...</p></div>;

  if (!session) return (
    <div className="h-[100dvh] bg-black text-white flex flex-col items-center justify-center gap-3">
      <ShoppingBag className="w-16 h-16 text-zinc-600" /><p className="text-zinc-400 text-lg font-medium">Nenhuma live no momento</p><p className="text-zinc-500 text-sm">Volte em breve! 🎉</p>
    </div>
  );

  return (
    <div className="h-[100dvh] bg-black text-white flex flex-col overflow-hidden relative" translate="no">
      {/* Lead Gate Modal */}
      {showGate && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center px-4" onClick={() => setShowGate(false)}>
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

      {/* Variant Selector Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-end justify-center" onClick={() => setSelectedProduct(null)}>
          <div className="bg-zinc-900 rounded-t-2xl w-full max-w-md max-h-[60vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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

      {/* Cart Drawer - full overlay */}
      {drawerView === "cart" && (
        <div className="fixed inset-0 z-[55] bg-black/80 flex items-end justify-center" onClick={() => setDrawerView("closed")}>
          <div className="bg-zinc-900 rounded-t-2xl w-full max-w-md max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800">
              <h2 className="text-sm font-bold">Meu Carrinho ({cartCount})</h2>
              <button onClick={() => setDrawerView("closed")} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {cart.length === 0 ? (
              <div className="text-center py-8">
                <ShoppingCart className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
                <p className="text-zinc-500 text-sm">Seu carrinho está vazio</p>
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
                    {checkingOut ? "Gerando checkout..." : "Finalizar Compra 🛒"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== VERTICAL FULLSCREEN VIDEO ===== */}
      <div ref={videoContainerRef} className="flex-1 relative overflow-hidden bg-black">
        {isLive ? (
          <>
            <iframe
              ref={iframeRef}
              className="absolute inset-0 w-full h-full object-cover"
              src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1&controls=0&enablejsapi=1&live=1`}
              title="Live"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="eager"
              style={{ pointerEvents: "auto" }}
            />
            {iframeMuted && (
              <button
                onClick={() => {
                  if (iframeRef.current?.contentWindow) {
                    // Use YouTube IFrame API postMessage to unmute without reloading
                    iframeRef.current.contentWindow.postMessage(
                      JSON.stringify({ event: "command", func: "unMute", args: [] }),
                      "*"
                    );
                    iframeRef.current.contentWindow.postMessage(
                      JSON.stringify({ event: "command", func: "setVolume", args: [100] }),
                      "*"
                    );
                    iframeRef.current.contentWindow.postMessage(
                      JSON.stringify({ event: "command", func: "playVideo", args: [] }),
                      "*"
                    );
                  }
                  setIframeMuted(false);
                }}
                className="absolute bottom-32 left-1/2 -translate-x-1/2 z-20 bg-black/90 backdrop-blur-md rounded-xl px-6 py-4 flex items-center gap-3 text-white font-bold shadow-2xl border border-white/20 animate-pulse"
              >
                <span className="text-2xl">🔊</span>
                <span className="text-sm leading-tight">CLIQUE PRA<br/>ESCUTAR A LIVE</span>
              </button>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 gap-3">
            <ShoppingBag className="w-8 h-8 text-zinc-500" />
            <p className="text-zinc-400">Aguardando transmissão...</p>
          </div>
        )}

        {/* ===== OVERLAYS ON TOP OF VIDEO ===== */}

        {/* Top bar: title + viewers + PiP */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 pt-3 pb-6 bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex items-center gap-2">
            <img src="/images/banana-logo.png" alt="" className="w-8 h-8 rounded-full object-cover border-2 border-amber-500" />
            <div>
              <p className="text-xs font-bold leading-tight">{session.title}</p>
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-300">
                {isLive && <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[9px] font-bold">AO VIVO</span>}
                <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{publicViewerCount}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {whatsappLink && (
              <a href={whatsappLink} target="_blank" rel="noopener noreferrer"
                className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                <MessageCircle className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {/* ===== LIVE OVERLAYS (banner, coupon, countdown, promo) ===== */}
        <div className="absolute top-14 left-0 right-0 z-10 px-3 space-y-1.5 pointer-events-none">
          {overlay.show_banner && overlay.banner_text && (
            <div className="bg-amber-500/90 backdrop-blur-sm text-black text-[11px] font-bold text-center py-1.5 px-3 rounded-lg animate-fade-in">
              📢 {overlay.banner_text}
            </div>
          )}
          {overlay.show_coupon && overlay.coupon_code && (
            <div className="bg-green-600/90 backdrop-blur-sm text-white text-[11px] font-bold text-center py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 animate-fade-in">
              <Tag className="w-3.5 h-3.5" /> USE O CUPOM: <span className="bg-white/20 px-2 py-0.5 rounded text-[12px] tracking-wider">{overlay.coupon_code}</span>
            </div>
          )}
          {overlay.show_countdown && countdownText && (
            <div className="bg-red-600/90 backdrop-blur-sm text-white text-[11px] font-bold text-center py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 animate-pulse">
              <Timer className="w-3.5 h-3.5" /> {countdownText}
            </div>
          )}
          {overlay.show_promo && overlay.promo_text && (
            <div className="bg-purple-600/90 backdrop-blur-sm text-white text-[11px] font-bold text-center py-1.5 px-3 rounded-lg animate-fade-in">
              🔥 {overlay.promo_text}
            </div>
          )}
        </div>
        <div className={`absolute left-0 right-16 z-10 max-h-[35vh] flex flex-col pointer-events-none ${cartCount > 0 ? 'bottom-36' : 'bottom-20'}`}>
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 space-y-1 scrollbar-hide pointer-events-auto">
            {chatMessages.slice(-30).map((msg: any) => (
              <div key={msg.id} className="animate-fade-in">
                {msg.message_type === "system" ? (
                  <p className="text-[10px] text-zinc-400 italic">{msg.message}</p>
                ) : (
                  <p className="text-[12px] leading-tight drop-shadow-lg">
                    <span className={`font-bold ${getNameColor(msg.viewer_name)}`}>{msg.viewer_name}</span>
                    <span className="text-white ml-1.5">{msg.message}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Chat input (bottom, full width) */}
        <div className="absolute bottom-0 left-0 right-0 z-10 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex items-center gap-2">
            <button
              onClick={() => requireViewer("chat", () => {})}
              className="flex-1"
            >
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); requireViewer("chat", sendChatMessage); } }}
                onFocus={() => { if (!viewer) { requireViewer("chat", () => {}); } }}
                placeholder={viewer ? "Comente aqui..." : "Cadastre-se para comentar..."}
                readOnly={!viewer}
                maxLength={200}
                className="w-full bg-zinc-800/80 backdrop-blur-sm rounded-full px-4 py-2.5 text-xs text-white placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-amber-500/50"
              />
            </button>
            {viewer && chatInput.trim() && (
              <button onClick={sendChatMessage} disabled={sendingChat}
                className="w-9 h-9 rounded-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 flex items-center justify-center flex-shrink-0">
                <Send className="w-4 h-4 text-black" />
              </button>
            )}
            {/* Cart button */}
            <button onClick={() => setDrawerView(v => v === "cart" ? "closed" : "cart")}
              className="w-9 h-9 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0 relative">
              <ShoppingCart className="w-4 h-4 text-black" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{cartCount}</span>
              )}
            </button>
          </div>
        </div>

        {/* ===== PRODUCT CARDS (TikTok-style, bottom-right) ===== */}
        {products.length > 0 && showProducts && (
          <div className={`absolute right-2 z-10 flex flex-col gap-2 items-end max-h-[50vh] overflow-y-auto scrollbar-hide ${cartCount > 0 ? 'bottom-36' : 'bottom-20'}`}>
            {products.slice(0, 3).map(p => {
              const product = p.node;
              const image = product.images.edges[0]?.node.url;
              const price = parseFloat(product.priceRange.minVariantPrice.amount);
              const hasVariants = product.variants.edges.length > 1;
              return (
                <button
                  key={product.id}
                  className="bg-black/70 backdrop-blur-md rounded-xl overflow-hidden w-[72px] flex flex-col items-center transition-all hover:scale-105 active:scale-95 border border-white/10"
                  onClick={() => {
                    if (hasVariants) { requireViewer("cart", () => setSelectedProduct(p)); }
                    else {
                      const v = product.variants.edges[0]?.node;
                      if (v?.availableForSale) requireViewer("cart", () => addToCart({ id: v.id, title: v.title, price: parseFloat(v.price.amount) }, product.title, image));
                      else toast.error("Esgotado");
                    }
                  }}
                >
                  {image && <img src={image} alt="" className="w-full aspect-square object-cover" loading="lazy" />}
                  <div className="px-1.5 py-1.5 text-center w-full">
                    <p className="text-[9px] font-medium line-clamp-1 leading-tight">{product.title}</p>
                    <p className="text-[11px] font-bold text-green-400 mt-0.5">R${price.toFixed(0)}</p>
                    <span className="text-[8px] text-amber-400 font-semibold">COMPRAR</span>
                  </div>
                </button>
              );
            })}
            {products.length > 3 && (
              <button
                className="bg-black/70 backdrop-blur-md rounded-xl w-[72px] py-2 text-center border border-white/10"
                onClick={() => {
                  setSelectedProduct(null);
                  setShowProducts(false);
                  setTimeout(() => setShowProducts(true), 10);
                }}
              >
                <p className="text-[10px] font-bold text-amber-400">+{products.length - 3}</p>
                <ChevronUp className="w-3 h-3 mx-auto text-zinc-400" />
              </button>
            )}
          </div>
        )}

        {/* ===== FLOATING CHECKOUT BUTTON (visible when cart has items) ===== */}
        {cartCount > 0 && (
          <div className="absolute bottom-14 left-3 right-20 z-10">
            <button
              onClick={() => requireViewer("cart", handleCheckout)}
              disabled={checkingOut}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold text-sm py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-green-900/40 transition-all active:scale-95"
            >
              <ShoppingCart className="w-4 h-4" />
              {checkingOut ? "Abrindo checkout..." : `FINALIZAR COMPRA • R$ ${cartTotal.toFixed(2).replace(".", ",")}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveCommerce;
