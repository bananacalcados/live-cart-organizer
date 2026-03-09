import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Globe, Search, Plus, Minus, Trash2, ShoppingCart, Loader2,
  Copy, Check, Image, Filter, Link2, ExternalLink, X, ArrowLeft,
  Truck, UserPlus, Banknote, CreditCard, MessageSquareText, Bike,
  Pencil, Tag, Package, Percent, Gift
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts } from "@/lib/shopify";
import { toast } from "sonner";
import { POSCustomerForm } from "./POSCustomerForm";

interface Seller {
  id: string;
  name: string;
  tiny_seller_id?: string;
}

interface CartItem {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  variantLabel: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  quantity: number;
  imageUrl: string | null;
}

interface FoundCustomer {
  id: string;
  name: string | null;
  whatsapp: string | null;
  cpf: string | null;
  email: string | null;
  address?: string | null;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}

interface Props {
  storeId: string;
  sellers: Seller[];
}

type Gateway = "yampi" | "store-checkout" | "paypal" | "pix" | "delivery" | "pickup";

const GATEWAYS: { id: Gateway; label: string; color: string; icon: typeof Link2; highlight?: boolean }[] = [
  { id: "store-checkout", label: "🏆 Checkout Loja (+10 pts)", color: "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700", icon: Link2, highlight: true },
  { id: "yampi", label: "Yampi", color: "bg-purple-600 hover:bg-purple-700", icon: Link2 },
  { id: "paypal", label: "PayPal", color: "bg-blue-600 hover:bg-blue-700", icon: Link2 },
  { id: "pix", label: "PIX", color: "bg-green-600 hover:bg-green-700", icon: Link2 },
  { id: "delivery", label: "Na Entrega", color: "bg-orange-600 hover:bg-orange-700", icon: Truck },
  { id: "pickup", label: "Retirar na Loja", color: "bg-teal-600 hover:bg-teal-700", icon: Package },
];

export function POSOnlineSales({ storeId, sellers }: Props) {
  const [products, setProducts] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedSeller, setSelectedSeller] = useState("");
  const [stockStore, setStockStore] = useState(storeId);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [mobileStep, setMobileStep] = useState<"catalog" | "cart">("catalog");
  const [allCollections, setAllCollections] = useState<string[]>([]);
  const [allSizes, setAllSizes] = useState<string[]>([]);

  // Customer search states
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<FoundCustomer[]>([]);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [linkedCustomer, setLinkedCustomer] = useState<FoundCustomer | null>(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);

  // Delivery payment states
  const [showDeliveryOptions, setShowDeliveryOptions] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<"cash" | "card">("cash");

  // Pickup states
  const [showPickupOptions, setShowPickupOptions] = useState(false);
  const [pickupStoreId, setPickupStoreId] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false);
  const [installments, setInstallments] = useState("1");
  const [needsChange, setNeedsChange] = useState(false);
  const [changeAmount, setChangeAmount] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryReference, setDeliveryReference] = useState("");

  // Coupon & price editing & discount & shipping
  const [couponCode, setCouponCode] = useState("");
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState("");
  const [discountValue, setDiscountValue] = useState("");
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [shippingValue, setShippingValue] = useState("");
  const [hasGift, setHasGift] = useState(false);
  const [giftDescription, setGiftDescription] = useState("");
  
  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Load stores
  useEffect(() => {
    supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setStores(data);
      });
  }, []);

  // Load products from Shopify
  useEffect(() => {
    loadProducts();
  }, [debouncedSearch]);

  // Customer search
  useEffect(() => {
    if (customerSearch.length < 3) {
      setCustomerResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearchingCustomer(true);
      const term = `%${customerSearch}%`;
      const { data } = await supabase
        .from("pos_customers")
        .select("id, name, whatsapp, cpf, email, address, address_number, complement, neighborhood, city, state, cep")
        .or(`name.ilike.${term},cpf.ilike.${term},whatsapp.ilike.${term}`)
        .limit(5);
      setCustomerResults((data as FoundCustomer[]) || []);
      setSearchingCustomer(false);
    }, 400);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const loadProducts = async () => {
    setLoading(true);
    const query = debouncedSearch.trim() ? `title:*${debouncedSearch}*` : undefined;
    const shopifyProducts = await fetchProducts(250, query);

    const items: CartItem[] = [];
    const collections = new Set<string>();
    const sizes = new Set<string>();

    for (const sp of shopifyProducts) {
      const node = sp.node;
      const fallbackImg = node.images.edges[0]?.node.url || null;
      node.collections?.edges?.forEach(e => collections.add(e.node.title));

      for (const ve of node.variants.edges) {
        const v = ve.node;
        if (!v.availableForSale) continue;
        const price = parseFloat(v.price.amount);
        const compareAt = v.compareAtPrice ? parseFloat(v.compareAtPrice.amount) : null;

        for (const opt of v.selectedOptions) {
          const n = opt.name.toLowerCase();
          if (n === "tamanho" || n === "size") sizes.add(opt.value);
        }

        const variantParts = v.selectedOptions.filter(o => o.value !== "Default Title").map(o => o.value);

        items.push({
          id: `${node.id}::${v.id}`,
          productId: node.id,
          variantId: v.id,
          title: node.title,
          variantLabel: variantParts.join(" / "),
          sku: v.sku || "",
          price,
          compareAtPrice: compareAt && compareAt > price ? compareAt : null,
          quantity: 1,
          imageUrl: v.image?.url || fallbackImg,
        });
      }
    }

    setProducts(items);
    setAllCollections(Array.from(collections).sort());
    setAllSizes(Array.from(sizes).sort());
    setLoading(false);
  };

  const filtered = useMemo(() => {
    return products.filter(() => true);
  }, [products, collectionFilter, sizeFilter]);

  const addToCart = (item: CartItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id);
      if (existing) {
        return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateCartQty = (id: string, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.id !== id) return c;
      const q = Math.max(1, c.quantity + delta);
      return { ...c, quantity: q };
    }));
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id));

  const cartSubtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  const discountAmount = (() => {
    const val = parseFloat(discountValue);
    if (!val || val <= 0) return 0;
    if (discountType === "percent") return Math.min(cartSubtotal, cartSubtotal * (val / 100));
    return Math.min(cartSubtotal, val);
  })();

  const cartTotal = Math.max(0, cartSubtotal - discountAmount);
  const shippingAmount = parseFloat(shippingValue) || 0;
  const orderTotal = cartTotal + shippingAmount;

  const updateCartPrice = (id: string, newPrice: number) => {
    if (newPrice <= 0) return;
    setCart(prev => prev.map(c => c.id === id ? { ...c, price: newPrice } : c));
    setEditingPriceId(null);
    setEditPriceValue("");
  };
  const cartItems = cart.reduce((s, c) => s + c.quantity, 0);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const handleGenerateLink = async (gateway: Gateway) => {
    if (!selectedSeller) { toast.error("Selecione a vendedora"); return; }
    if (cart.length === 0) { toast.error("Adicione produtos ao carrinho"); return; }

    // If delivery, show options first
    if (gateway === "delivery") {
      setShowDeliveryOptions(true);
      return;
    }

    // If pickup, show store selector first
    if (gateway === "pickup") {
      setShowPickupOptions(true);
      return;
    }

    await processPayment(gateway);
  };

  const handleDeliveryConfirm = async () => {
    setShowDeliveryOptions(false);
    await processPayment("delivery");
  };

  const handlePickupConfirm = async () => {
    if (!pickupStoreId) { toast.error("Selecione a loja de retirada"); return; }
    setShowPickupOptions(false);
    await processPayment("pickup");
  };

  const createTinyOrder = async () => {
    try {
      const sellerObj = sellers.find(s => s.id === selectedSeller);
      const { data } = await supabase.functions.invoke("pos-tiny-create-sale", {
        body: {
          store_id: storeId,
          seller_id: selectedSeller,
          tiny_seller_id: sellerObj?.tiny_seller_id || null,
          customer: linkedCustomer ? {
            name: linkedCustomer.name,
            cpf: linkedCustomer.cpf,
            email: linkedCustomer.email,
            whatsapp: linkedCustomer.whatsapp,
            address: linkedCustomer.address,
            cep: linkedCustomer.cep,
            city: linkedCustomer.city,
            state: linkedCustomer.state,
          } : undefined,
          items: cart.map(c => ({
            sku: c.sku,
            name: c.title,
            variant: c.variantLabel,
            quantity: c.quantity,
            price: c.price,
          })),
          payment_method_name: "Venda Online",
          notes: deliveryNotes || undefined,
        },
      });
      return data;
    } catch (e) {
      console.error("Tiny order creation failed:", e);
      return null;
    }
  };

  const ensureCrmOrder = async (): Promise<string | null> => {
    try {
      // Find or create default "Vendas Online" event
      let { data: event } = await supabase
        .from("events")
        .select("id")
        .eq("name", "Vendas Online POS")
        .maybeSingle();

      if (!event) {
        const { data: newEvent } = await supabase
          .from("events")
          .insert({ name: "Vendas Online POS", description: "Pedidos gerados pelo módulo de venda online do POS", is_active: true })
          .select("id")
          .single();
        event = newEvent;
      }
      if (!event) throw new Error("Evento não criado");

      // Find or create customer in CRM customers table
      let customerId: string | null = null;
      const handle = linkedCustomer?.whatsapp || linkedCustomer?.name || "POS-Customer";
      const { data: existingCust } = await supabase
        .from("customers")
        .select("id")
        .eq("instagram_handle", handle)
        .maybeSingle();

      if (existingCust) {
        customerId = existingCust.id;
      } else {
        const { data: newCust } = await supabase
          .from("customers")
          .insert({ instagram_handle: handle, whatsapp: linkedCustomer?.whatsapp })
          .select("id")
          .single();
        customerId = newCust?.id || null;
      }
      if (!customerId) throw new Error("Cliente não criado");

      // Create order
      const products = cart.map(c => ({
        title: c.title,
        variant: c.variantLabel,
        price: c.price,
        quantity: c.quantity,
        image: c.imageUrl,
        sku: c.sku,
        shopifyId: c.variantId,
      }));

      const { data: order } = await supabase
        .from("orders")
        .insert({
          event_id: event.id,
          customer_id: customerId,
          products,
          stage: "new",
          notes: deliveryNotes || null,
          coupon_code: couponCode || null,
        })
        .select("id")
        .single();

      return order?.id || null;
    } catch (e) {
      console.error("CRM order creation failed:", e);
      return null;
    }
  };

  const processPayment = async (gateway: Gateway) => {
    setGenerating(true);
    setGeneratedLink("");

    try {
      let link = "";

      if (gateway === "delivery" || gateway === "pickup") {
        link = "";
      } else if (gateway === "yampi") {
        const items = cart.map(c => ({
          sku: c.sku,
          shopify_variant_id: c.variantId,
          quantity: c.quantity,
          price: c.price,
        }));
        const { data, error } = await supabase.functions.invoke("yampi-create-payment-link", {
          body: {
            items,
            customer: linkedCustomer?.name || linkedCustomer?.whatsapp ? { name: linkedCustomer.name, phone: linkedCustomer.whatsapp } : undefined,
            ...(couponCode && { coupon_code: couponCode }),
          },
        });
        if (error || !data?.success) throw new Error(data?.error || error?.message || "Erro Yampi");
        link = data.payment_link;
      } else if (gateway === "store-checkout") {
        // Store checkout: save sale first, then generate link
        // Sale will be saved below in the common flow, so we generate a placeholder
        link = "__STORE_CHECKOUT__";
      } else if (gateway === "paypal") {
        // Create CRM order first, then create PayPal order from it
        const orderId = await ensureCrmOrder();
        if (!orderId) throw new Error("Erro ao criar pedido para PayPal");
        const { data, error } = await supabase.functions.invoke("paypal-create-order", {
          body: { orderId },
        });
        if (error || !data?.approvalUrl) throw new Error(data?.error || "Erro PayPal");
        link = data.approvalUrl;
      } else if (gateway === "pix") {
        // PIX requires orderId — sale will be created first below, then PIX generated
        link = "__PIX_PENDING__";
      }

      if (gateway !== "delivery" && gateway !== "pickup" && gateway !== "store-checkout" && !link) throw new Error("Link não gerado");

      // For store-checkout, we need to save the sale first and then generate the link
      if (gateway !== "store-checkout") {
        setGeneratedLink(link || "DELIVERY_CONFIRMED");
      }
      if (gateway === "delivery") setDeliveryConfirmed(true);
      if (gateway === "pickup") setDeliveryConfirmed(true);

      // Save sale to pos_sales
      const sellerObj = sellers.find(s => s.id === selectedSeller);
      const paymentGw = gateway === "delivery" ? `delivery_${deliveryMethod}` : gateway;
      const saleStoreId = gateway === "pickup" ? pickupStoreId : storeId;
      const salePayload = {
        store_id: saleStoreId,
        seller_id: selectedSeller,
        customer_id: linkedCustomer?.id || null,
        subtotal: cartSubtotal,
        discount: discountAmount > 0 ? discountAmount : 0,
        total: orderTotal,
        status: gateway === "pickup" ? "pending_pickup" : "online_pending",
        sale_type: gateway === "pickup" ? "pickup" : "online",
        payment_gateway: paymentGw,
        payment_link: (gateway === "delivery" || gateway === "pickup" || gateway === "store-checkout") ? null : link,
        stock_source_store_id: stockStore,
        payment_method_detail: gateway === "delivery" ? deliveryMethod : null,
        payment_details: {
          seller_name: sellerObj?.name || "",
          customer_name: linkedCustomer?.name || null,
          customer_phone: linkedCustomer?.whatsapp || null,
          customer_email: linkedCustomer?.email || null,
          original_subtotal: cartSubtotal,
          discount_amount: discountAmount,
          discount_type: discountType,
          discount_value: discountValue,
          shipping_amount: shippingAmount,
          has_gift: hasGift,
          gift_description: hasGift ? giftDescription : null,
          net_product_total: cartTotal,
          items_detail: cart.map(c => ({
            title: c.title,
            variant: c.variantLabel,
            unit_price: c.price,
            compare_at_price: c.compareAtPrice,
            quantity: c.quantity,
          })),
        },
        notes: deliveryNotes || null,
      };

      const { data: sale, error: saleErr } = await supabase
        .from("pos_sales")
        .insert(salePayload as any)
        .select("id")
        .single();

      if (saleErr || !sale) {
        throw new Error(saleErr?.message || "Não foi possível salvar a venda");
      }

      // Save sale items
      const saleItems = cart.map(c => ({
        sale_id: sale.id,
        sku: c.sku || null,
        barcode: null,
        product_name: c.title,
        variant_name: c.variantLabel || null,
        unit_price: c.price,
        quantity: c.quantity,
        total_price: c.price * c.quantity,
      }));

      const { error: saleItemsErr } = await supabase.from("pos_sale_items").insert(saleItems as any);
      if (saleItemsErr) {
        throw new Error(saleItemsErr.message || "Não foi possível salvar os itens da venda");
      }

      // For store-checkout, generate the link using the sale ID
      if (gateway === "store-checkout" && sale) {
        const storeCheckoutLink = `https://checkout.bananacalcados.com.br/checkout-loja/${storeId}/${sale.id}`;
        setGeneratedLink(storeCheckoutLink);
        setShowLinkDialog(true);
      }

      // Create Tiny order for delivery, PayPal and PIX
      if (gateway === "delivery" || gateway === "paypal" || gateway === "pix") {
        const tinyResult = await createTinyOrder();
        if (tinyResult?.success) {
          console.log("Tiny order created:", tinyResult.tiny_order_id);
        } else {
          console.warn("Tiny order failed (sale saved locally):", tinyResult?.error);
        }
      }

      // Transfer stock: source store -> Site
      for (const item of cart) {
        if (!item.sku) continue;
        try {
          await supabase.functions.invoke("expedition-transfer-stock", {
            body: {
              sku: item.sku,
              source_store_id: stockStore,
              quantity: item.quantity,
            },
          });
        } catch (e) {
          console.error(`Stock transfer failed for ${item.sku}:`, e);
        }
      }

      toast.success(gateway === "pickup" ? "Retirada na loja registrada!" : gateway === "delivery" ? "Venda registrada!" : "Link gerado com sucesso!");
    } catch (e: any) {
      console.error("Generate link error:", e);
      toast.error(e.message || "Erro ao gerar link");
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    // Method 1: Clipboard API
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fallthrough
    }

    // Method 2: execCommand fallback
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      Object.assign(el.style, { position: "fixed", top: "0", left: "0", opacity: "0", width: "1px", height: "1px" });
      document.body.appendChild(el);
      el.focus();
      el.select();
      el.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      if (ok) return true;
    } catch {
      // fallthrough
    }

    // Method 3: window.prompt fallback (user can Ctrl+C)
    try {
      window.prompt("Copie o link abaixo (Ctrl+C):", text);
      return true;
    } catch {
      return false;
    }
  };

  const copyLink = async () => {
    if (!generatedLink) {
      toast.error("Nenhum link para copiar");
      return;
    }
    const ok = await copyToClipboard(generatedLink);
    if (!ok) {
      toast.error("Não foi possível copiar automaticamente. Copie manualmente o link exibido.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copiado!");
  };

  const sendWhatsApp = () => {
    const phone = linkedCustomer?.whatsapp?.replace(/\D/g, "") || "";
    let text: string;

    if (deliveryConfirmed) {
      const methodLabel = deliveryMethod === "cash" ? "dinheiro" : "cartão (maquininha)";
      text = `Olá${linkedCustomer?.name ? ` ${linkedCustomer.name}` : ""}! Seu pedido foi separado.\n\nValor dos produtos: ${fmt(cartTotal)}${shippingAmount > 0 ? `\nFrete: ${fmt(shippingAmount)}` : " (frete grátis)"}\nValor total: ${fmt(orderTotal)}\nPagamento na entrega: ${methodLabel}\n\nItens:\n${cart.map(c => `• ${c.title}${c.variantLabel ? ` (${c.variantLabel})` : ""} x${c.quantity} - ${fmt(c.price * c.quantity)}`).join("\n")}${hasGift && giftDescription ? `\n\n🎁 *Brinde:* ${giftDescription}` : ""}${deliveryNotes ? `\n\nObs: ${deliveryNotes}` : ""}`;
    } else {
      text = `Olá! Aqui está o link para pagamento: ${generatedLink}`;
    }

    const url = phone
      ? `https://wa.me/55${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const resetSale = () => {
    setCart([]);
    setGeneratedLink("");
    setShowLinkDialog(false);
    setLinkedCustomer(null);
    setCustomerSearch("");
    setMobileStep("catalog");
    setDeliveryConfirmed(false);
    setDeliveryNotes("");
    setShowDeliveryOptions(false);
    setShowPickupOptions(false);
    setPickupStoreId("");
    setInstallments("1");
    setNeedsChange(false);
    setChangeAmount("");
    setDeliveryAddress("");
    setDeliveryReference("");
    setCouponCode("");
    setEditingPriceId(null);
    setEditPriceValue("");
    setDiscountValue("");
    setDiscountType("fixed");
    setShippingValue("");
    setHasGift(false);
    setGiftDescription("");
  };

  const selectCustomer = (c: FoundCustomer) => {
    setLinkedCustomer(c);
    setCustomerSearch("");
    setCustomerResults([]);
    // Auto-fill address
    const parts = [c.address, c.address_number, c.complement, c.neighborhood, c.city, c.state].filter(Boolean);
    if (parts.length > 0) setDeliveryAddress(parts.join(", "));
  };

  const handleCustomerSaved = (customer: { id: string; name: string; cpf?: string }) => {
    setLinkedCustomer({ id: customer.id, name: customer.name, cpf: customer.cpf || null, whatsapp: null, email: null });
    setShowCustomerForm(false);
  };

  const getFullAddress = () => {
    if (deliveryAddress) return deliveryAddress;
    if (!linkedCustomer) return "";
    const parts = [linkedCustomer.address, linkedCustomer.address_number, linkedCustomer.complement, linkedCustomer.neighborhood, linkedCustomer.city, linkedCustomer.state].filter(Boolean);
    return parts.join(", ");
  };

  const buildClientText = () => {
    const methodLabel = deliveryMethod === "cash"
      ? `Dinheiro${needsChange ? ` (troco para R$ ${changeAmount})` : " (sem necessidade de troco)"}`
      : `Cartão na maquininha${installments !== "1" ? ` em ${installments}x` : " à vista"}`;
    const itemsList = cart.map(c => `• ${c.title}${c.variantLabel ? ` (${c.variantLabel})` : ""} x${c.quantity} — ${fmt(c.price * c.quantity)}`).join("\n");

    return `Olá${linkedCustomer?.name ? `, ${linkedCustomer.name}` : ""}! 😊\n\nSeu pedido foi separado e já está saindo para entrega!\n\n📦 *Itens:*\n${itemsList}\n\n💰 *Produtos: ${fmt(cartTotal)}*${shippingAmount > 0 ? `\n🚚 *Frete: ${fmt(shippingAmount)}*` : "\n🚚 *Frete grátis!*"}\n💰 *Total: ${fmt(orderTotal)}*\n💳 *Pagamento:* ${methodLabel}${hasGift && giftDescription ? `\n\n🎁 *Brinde:* ${giftDescription}` : ""}\n\n🏍️ O entregador é um *mototaxista parceiro*. Ele não consegue aguardar experimentação na porta, mas caso algum item não sirva, é só nos avisar que chamamos outro mototaxista para realizar a troca diretamente na sua casa! 🔄\n\nQualquer dúvida, estamos à disposição! 💛`;
  };

  const buildMotoText = () => {
    const methodLabel = deliveryMethod === "cash"
      ? `💵 DINHEIRO${needsChange ? ` — Levar troco para R$ ${changeAmount}` : " — Sem troco"}`
      : `💳 MAQUININHA${installments !== "1" ? ` — ${installments}x` : " — À vista"}`;
    const addr = getFullAddress();

    return `🏍️ *ENTREGA BANANA CALÇADOS*\n\n👤 *Cliente:* ${linkedCustomer?.name || "—"}\n📱 *Telefone:* ${linkedCustomer?.whatsapp || "—"}\n\n📍 *Endereço:* ${addr || "—"}${deliveryReference ? `\n📌 *Referência:* ${deliveryReference}` : ""}\n\n💰 *Valor produtos:* ${fmt(cartTotal)}${shippingAmount > 0 ? `\n🚚 *Frete:* ${fmt(shippingAmount)}` : ""}\n💰 *Total:* ${fmt(orderTotal)}\n${methodLabel}${hasGift && giftDescription ? `\n\n🎁 *Brinde:* ${giftDescription}` : ""}\n\n📦 *Itens:* ${cart.map(c => `${c.title}${c.variantLabel ? ` (${c.variantLabel})` : ""} x${c.quantity}`).join(", ")}${deliveryNotes ? `\n\n📝 *Obs:* ${deliveryNotes}` : ""}`;
  };

  const copyText = async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) toast.success("Texto copiado!");
    else toast.error("Não foi possível copiar. Selecione e copie manualmente.");
  };

  const openWhatsAppWith = (text: string, phone?: string) => {
    const cleanPhone = phone?.replace(/\D/g, "") || "";
    const url = cleanPhone
      ? `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  // Desktop: 2 columns. Mobile: steps
  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden">
      {/* Catalog / Left Column */}
      <div className={cn(
        "flex-1 flex flex-col border-r border-border min-w-0",
        mobileStep === "cart" && "hidden md:flex"
      )}>
        {/* Header */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-bold">Venda Online</h2>
            {cartItems > 0 && (
              <Badge
                className="bg-primary text-primary-foreground cursor-pointer md:hidden"
                onClick={() => setMobileStep("cart")}
              >
                <ShoppingCart className="h-3 w-3 mr-1" />
                {cartItems}
              </Badge>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          {(allCollections.length > 0 || allSizes.length > 0) && (
            <div className="flex gap-2 flex-wrap">
              {allCollections.length > 0 && (
                <Select value={collectionFilter} onValueChange={setCollectionFilter}>
                  <SelectTrigger className="h-7 text-xs w-auto min-w-[120px]">
                    <Filter className="h-3 w-3 mr-1" />
                    <SelectValue placeholder="Coleção" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {allCollections.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {allSizes.length > 0 && (
                <Select value={sizeFilter} onValueChange={setSizeFilter}>
                  <SelectTrigger className="h-7 text-xs w-auto min-w-[90px]">
                    <SelectValue placeholder="Tam." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {allSizes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        {/* Product Grid */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Nenhum produto encontrado</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-3">
              {filtered.map(p => {
                const inCart = cart.find(c => c.id === p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className={cn(
                      "relative text-left rounded-xl border p-2 transition-all",
                      inCart
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    {inCart && (
                      <Badge className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground border-0 text-[10px] h-5 min-w-5 px-1 z-10">
                        {inCart.quantity}
                      </Badge>
                    )}
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.title} className="w-full aspect-square object-cover rounded-lg mb-1.5" />
                    ) : (
                      <div className="w-full aspect-square bg-muted rounded-lg mb-1.5 flex items-center justify-center">
                        <Image className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                    )}
                    <p className="text-xs font-medium line-clamp-1">{p.title}</p>
                    {p.variantLabel && <p className="text-[11px] font-semibold text-primary line-clamp-1">{p.variantLabel}</p>}
                    {p.sku && <p className="text-[10px] text-muted-foreground">SKU: {p.sku}</p>}
                    <div className="mt-1">
                      {p.compareAtPrice ? (
                        <>
                          <span className="text-[10px] line-through text-muted-foreground">{fmt(p.compareAtPrice)}</span>
                          <span className="text-xs font-bold text-primary ml-1">{fmt(p.price)}</span>
                        </>
                      ) : (
                        <span className="text-xs font-bold">{fmt(p.price)}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Cart / Right Column */}
      <div className={cn(
        "w-full md:w-96 flex flex-col bg-card",
        mobileStep === "catalog" && "hidden md:flex"
      )}>
        {/* Cart Header */}
        <div className="p-3 border-b border-border flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setMobileStep("catalog")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <ShoppingCart className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Carrinho ({cartItems})</span>
          <span className="ml-auto text-sm font-bold text-primary">{fmt(orderTotal)}</span>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {/* Cart Items */}
            {cart.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">Carrinho vazio</p>
            ) : (
              <div className="space-y-2">
                {cart.map(c => (
                  <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                    {c.imageUrl && (
                      <img src={c.imageUrl} className="h-10 w-10 rounded object-cover flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium line-clamp-1">{c.title}</p>
                      {c.variantLabel && <p className="text-[10px] text-muted-foreground">{c.variantLabel}</p>}
                      {editingPriceId === c.id ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Input
                            type="number"
                            value={editPriceValue}
                            onChange={e => setEditPriceValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") updateCartPrice(c.id, parseFloat(editPriceValue));
                              if (e.key === "Escape") { setEditingPriceId(null); setEditPriceValue(""); }
                            }}
                            className="h-6 w-20 text-xs px-1"
                            autoFocus
                          />
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => updateCartPrice(c.id, parseFloat(editPriceValue))}>
                            <Check className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="text-xs font-bold text-primary flex items-center gap-1 hover:underline"
                          onClick={() => { setEditingPriceId(c.id); setEditPriceValue(String(c.price)); }}
                        >
                          {fmt(c.price)} <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateCartQty(c.id, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="text-xs w-5 text-center font-bold">{c.quantity}</span>
                      <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateCartQty(c.id, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeFromCart(c.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Separator />

            {/* Seller */}
            <div className="space-y-1.5">
              <Label className="text-xs">Vendedora *</Label>
              <Select value={selectedSeller} onValueChange={setSelectedSeller}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione a vendedora" />
                </SelectTrigger>
                <SelectContent>
                  {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Stock Source Store */}
            <div className="space-y-1.5">
              <Label className="text-xs">Retirar estoque de</Label>
              <Select value={stockStore} onValueChange={setStockStore}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Loja de estoque" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Customer Search */}
            <div className="space-y-1.5">
              <Label className="text-xs">Cliente</Label>
              {linkedCustomer ? (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{linkedCustomer.name || "Sem nome"}</p>
                    {linkedCustomer.whatsapp && <p className="text-[10px] text-muted-foreground">{linkedCustomer.whatsapp}</p>}
                    {linkedCustomer.cpf && <p className="text-[10px] text-muted-foreground">CPF: {linkedCustomer.cpf}</p>}
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setLinkedCustomer(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <Input
                        placeholder="CPF, nome ou WhatsApp..."
                        value={customerSearch}
                        onChange={e => setCustomerSearch(e.target.value)}
                        className="pl-7 h-8 text-sm"
                      />
                      {searchingCustomer && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />}
                    </div>
                    <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShowCustomerForm(true)}>
                      <UserPlus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {customerResults.length > 0 && (
                    <div className="border border-border rounded-lg overflow-hidden">
                      {customerResults.map(c => (
                        <button
                          key={c.id}
                          onClick={() => selectCustomer(c)}
                          className="w-full text-left px-2 py-1.5 hover:bg-accent text-xs border-b border-border last:border-0 transition-colors"
                        >
                          <span className="font-medium">{c.name || "Sem nome"}</span>
                          {c.whatsapp && <span className="text-muted-foreground ml-2">{c.whatsapp}</span>}
                          {c.cpf && <span className="text-muted-foreground ml-2">CPF: {c.cpf}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Coupon Code */}
            {!generatedLink && !deliveryConfirmed && (
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Cupom de Desconto
                </Label>
                <Input
                  placeholder="Código do cupom (opcional)"
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase())}
                  className="h-8 text-xs"
                />
              </div>
            )}

            {/* Discount Field */}
            {!generatedLink && !deliveryConfirmed && cart.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <Percent className="h-3 w-3" /> Desconto
                </Label>
                <div className="flex gap-1.5">
                  <div className="flex rounded-md border border-border overflow-hidden shrink-0">
                    <button
                      onClick={() => setDiscountType("fixed")}
                      className={cn(
                        "px-2 py-1 text-[11px] font-medium transition-colors",
                        discountType === "fixed" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                      )}
                    >
                      R$
                    </button>
                    <button
                      onClick={() => setDiscountType("percent")}
                      className={cn(
                        "px-2 py-1 text-[11px] font-medium transition-colors",
                        discountType === "percent" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                      )}
                    >
                      %
                    </button>
                  </div>
                  <Input
                    type="number"
                    placeholder={discountType === "fixed" ? "Valor do desconto" : "% de desconto"}
                    value={discountValue}
                    onChange={e => setDiscountValue(e.target.value)}
                    className="h-8 text-xs flex-1"
                    min="0"
                    step={discountType === "percent" ? "1" : "0.01"}
                  />
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-xs px-1">
                    <span className="text-muted-foreground">Subtotal: {fmt(cartSubtotal)}</span>
                    <span className="text-green-600 font-medium">-{fmt(discountAmount)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Shipping / Frete */}
            {!generatedLink && !deliveryConfirmed && cart.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <Truck className="h-3 w-3" /> Frete
                </Label>
                <Input
                  type="number"
                  placeholder="0,00 = frete grátis"
                  value={shippingValue}
                  onChange={e => setShippingValue(e.target.value)}
                  className="h-8 text-xs"
                  min="0"
                  step="0.01"
                />
                {(discountAmount > 0 || shippingAmount > 0) && (
                  <div className="space-y-0.5 px-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Produtos:</span>
                      <span>{fmt(cartTotal)}</span>
                    </div>
                    {shippingAmount > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Frete:</span>
                        <span>{fmt(shippingAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs font-bold">
                      <span>Total:</span>
                      <span className="text-primary">{fmt(orderTotal)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Gift / Brinde */}
            {!generatedLink && !deliveryConfirmed && cart.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs flex items-center gap-1">
                    <Gift className="h-3 w-3" /> Incluir Brinde?
                  </Label>
                  <Switch checked={hasGift} onCheckedChange={setHasGift} />
                </div>
                {hasGift && (
                  <Input
                    placeholder="Ex: Meia de presente, Necessaire rosa..."
                    value={giftDescription}
                    onChange={e => setGiftDescription(e.target.value)}
                    className="h-8 text-xs"
                  />
                )}
              </div>
            )}

            {/* Payment Gateways */}
            {!generatedLink && !deliveryConfirmed ? (
              <>
                {/* Delivery options inline */}
                {showPickupOptions ? (
                  <div className="space-y-3 rounded-lg border border-teal-500/30 bg-teal-500/5 p-3">
                    <Label className="text-xs font-bold flex items-center gap-1.5">
                      <Package className="h-3.5 w-3.5 text-teal-600" />
                      Em qual loja o cliente vai retirar?
                    </Label>
                    <Select value={pickupStoreId} onValueChange={setPickupStoreId}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Selecione a loja de retirada" />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      placeholder="Observações (opcional)"
                      value={deliveryNotes}
                      onChange={e => setDeliveryNotes(e.target.value)}
                      className="h-16 text-xs"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowPickupOptions(false)}>
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 text-xs bg-teal-600 hover:bg-teal-700 text-white"
                        disabled={generating || !pickupStoreId}
                        onClick={handlePickupConfirm}
                      >
                        {generating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                        Confirmar Retirada
                      </Button>
                    </div>
                  </div>
                ) : showDeliveryOptions ? (
                  <div className="space-y-3 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                    <Label className="text-xs font-bold flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5 text-orange-600" />
                      Como será o pagamento na entrega?
                    </Label>
                    <RadioGroup value={deliveryMethod} onValueChange={(v) => setDeliveryMethod(v as "cash" | "card")} className="flex gap-3">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="cash" id="cash" />
                        <Label htmlFor="cash" className="text-xs flex items-center gap-1 cursor-pointer">
                          <Banknote className="h-3.5 w-3.5" /> Dinheiro
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="card" id="card" />
                        <Label htmlFor="card" className="text-xs flex items-center gap-1 cursor-pointer">
                          <CreditCard className="h-3.5 w-3.5" /> Maquininha
                        </Label>
                      </div>
                    </RadioGroup>

                    {/* Card: installments */}
                    {deliveryMethod === "card" && (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Parcelas</Label>
                        <Select value={installments} onValueChange={setInstallments}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                              <SelectItem key={n} value={String(n)}>
                                {n}x {n === 1 ? "(à vista)" : `de ${fmt(cartTotal / n)}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Cash: change needed */}
                    {deliveryMethod === "cash" && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="needsChange"
                            checked={needsChange}
                            onChange={e => setNeedsChange(e.target.checked)}
                            className="rounded border-border"
                          />
                          <Label htmlFor="needsChange" className="text-[11px] cursor-pointer">Precisa de troco?</Label>
                        </div>
                        {needsChange && (
                          <Input
                            placeholder="Troco para quanto? (ex: 200)"
                            value={changeAmount}
                            onChange={e => setChangeAmount(e.target.value)}
                            className="h-8 text-xs"
                            type="number"
                          />
                        )}
                      </div>
                    )}

                    {/* Address */}
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Endereço de entrega</Label>
                      <Input
                        placeholder="Rua, número, bairro, cidade..."
                        value={deliveryAddress}
                        onChange={e => setDeliveryAddress(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Referência</Label>
                      <Input
                        placeholder="Ponto de referência (opcional)"
                        value={deliveryReference}
                        onChange={e => setDeliveryReference(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>

                    <Textarea
                      placeholder="Observações (opcional)"
                      value={deliveryNotes}
                      onChange={e => setDeliveryNotes(e.target.value)}
                      className="h-16 text-xs"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowDeliveryOptions(false)}>
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 text-xs bg-orange-600 hover:bg-orange-700 text-white"
                        disabled={generating}
                        onClick={handleDeliveryConfirm}
                      >
                        {generating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                        Confirmar Venda
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs font-bold">Gerar Link / Pagamento</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {GATEWAYS.map(gw => {
                        const Icon = gw.icon;
                        return (
                          <Button
                            key={gw.id}
                            className={cn(
                              "text-white",
                              gw.color,
                              gw.highlight ? "col-span-2 h-12 text-sm font-bold shadow-lg ring-2 ring-amber-400/50" : "text-xs",
                              gw.id === "delivery" && "col-span-2"
                            )}
                            size={gw.highlight ? "lg" : "sm"}
                            disabled={generating || cart.length === 0}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleGenerateLink(gw.id);
                            }}
                          >
                            {generating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Icon className={cn("mr-1", gw.highlight ? "h-4 w-4" : "h-3 w-3")} />}
                            {gw.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                {deliveryConfirmed ? (
                  <>
                    <Label className="text-xs font-bold text-orange-600 flex items-center gap-1">
                      <Truck className="h-3.5 w-3.5" /> Venda Registrada — Pagamento na Entrega
                    </Label>
                    <div className="p-2 bg-orange-500/5 border border-orange-500/20 rounded-lg text-xs space-y-1">
                      <p><span className="font-medium">Método:</span> {deliveryMethod === "cash" ? `Dinheiro${needsChange ? ` (troco p/ R$ ${changeAmount})` : ""}` : `Maquininha ${installments}x`}</p>
                      <p><span className="font-medium">Produtos:</span> {fmt(cartTotal)}</p>
                      {shippingAmount > 0 && <p><span className="font-medium">Frete:</span> {fmt(shippingAmount)}</p>}
                      <p><span className="font-medium">Total:</span> {fmt(orderTotal)}</p>
                      {linkedCustomer?.name && <p><span className="font-medium">Cliente:</span> {linkedCustomer.name}</p>}
                      {getFullAddress() && <p><span className="font-medium">Endereço:</span> {getFullAddress()}</p>}
                      {deliveryNotes && <p><span className="font-medium">Obs:</span> {deliveryNotes}</p>}
                    </div>

                    {/* Text generation buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1"
                        onClick={() => {
                          const text = buildClientText();
                          copyText(text);
                        }}
                      >
                        <MessageSquareText className="h-3 w-3" />
                        Texto Cliente
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1"
                        onClick={() => openWhatsAppWith(buildClientText(), linkedCustomer?.whatsapp || undefined)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Enviar Cliente
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1"
                        onClick={() => {
                          const text = buildMotoText();
                          copyText(text);
                        }}
                      >
                        <Bike className="h-3 w-3" />
                        Texto Moto
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1"
                        onClick={() => openWhatsAppWith(buildMotoText())}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Enviar Moto
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Label className="text-xs font-bold text-green-600">✅ Link Gerado!</Label>
                    <div className="p-2 bg-muted rounded-lg">
                      <p className="text-xs break-all text-muted-foreground">{generatedLink}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={copyLink}>
                        {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                        {copied ? "Copiado" : "Copiar"}
                      </Button>
                      <Button size="sm" className="flex-1 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={sendWhatsApp}>
                        <ExternalLink className="h-3 w-3 mr-1" />
                        WhatsApp
                      </Button>
                    </div>
                  </>
                )}
                <Button size="sm" variant="ghost" className="w-full text-xs" onClick={resetSale}>
                  <Plus className="h-3 w-3 mr-1" /> Nova Venda
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Link Dialog (Checkout Loja / gateways) */}
      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Checkout Loja</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Copie o link abaixo ou envie direto no WhatsApp.</p>
            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <input
                readOnly
                value={generatedLink}
                className="w-full text-xs bg-transparent border-none outline-none select-all text-foreground cursor-text"
                onClick={e => (e.target as HTMLInputElement).select()}
                onFocus={e => e.target.select()}
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
              <Button type="button" className="flex-1" onClick={sendWhatsApp} disabled={!generatedLink}>
                <ExternalLink className="h-4 w-4 mr-2" />
                WhatsApp
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer Form Dialog */}
      <POSCustomerForm
        open={showCustomerForm}
        onOpenChange={setShowCustomerForm}
        onSaved={handleCustomerSaved}
      />
    </div>
  );
}