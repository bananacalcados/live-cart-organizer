import { useState, useEffect, useCallback, useRef } from "react";
import {
  ScanBarcode, Search, Plus, Minus, Trash2, User, CreditCard,
  Receipt, Printer, Camera, ShoppingCart, Package, Check,
  QrCode, Banknote, FileText, ChevronRight, Loader2, Users,
  Lock, MessageSquare, RotateCcw, Phone, Bell, Tag, Star, Gift
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { POSCustomerForm } from "./POSCustomerForm";
import { POSBarcodeScanner } from "./POSBarcodeScanner";
import { POSSellerGate } from "./POSSellerGate";
import { POSPrizeWheel } from "./POSPrizeWheel";
import { POSLoyaltyScreen } from "./POSLoyaltyScreen";
import { POSSlotMachine } from "./POSSlotMachine";
import { POSGiftBox } from "./POSGiftBox";
import { POSCrossSellSuggestions } from "./POSCrossSellSuggestions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CartItem {
  id: string;
  tiny_id?: number;
  sku: string;
  name: string;
  variant: string;
  size?: string;
  category?: string;
  price: number;
  quantity: number;
  barcode: string;
  stock?: number;
}

interface PaymentMethod {
  id: string;
  name: string;
}

interface Seller {
  id: string;
  name: string;
  tiny_seller_id?: string;
}

type SaleStep = "scan" | "customer" | "payment" | "invoice";

interface Props {
  storeId: string;
  sellerId?: string;
  preloadedSellers?: Seller[];
  sellersPreloaded?: boolean;
  onNavigateToWhatsApp?: (filter?: "unanswered" | "new") => void;
  onCloseSalesView?: () => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function POSSalesView({ storeId, sellerId, preloadedSellers, sellersPreloaded, onNavigateToWhatsApp, onCloseSalesView }: Props) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [step, setStep] = useState<SaleStep>("scan");
  const [showCamera, setShowCamera] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState("");
  const [multiPayments, setMultiPayments] = useState<{ method_id: string; method_name: string; amount: number }[]>([]);
  const [useMultiPayment, setUseMultiPayment] = useState(false);
  const [multiPaymentMethodId, setMultiPaymentMethodId] = useState("");
  const [multiPaymentAmount, setMultiPaymentAmount] = useState("");
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string; cpf?: string; email?: string; whatsapp?: string; address?: string; cep?: string; city?: string; state?: string; age_range?: string; preferred_style?: string; shoe_size?: string; gender?: string; neighborhood?: string; address_number?: string; complement?: string } | null>(null);
  const [customerCashback, setCustomerCashback] = useState<{ code: string; amount: number; type: string; min_purchase: number; expiry_date: string } | null>(null);
  const [customerPrizes, setCustomerPrizes] = useState<{ id: string; prize_label: string; coupon_code: string; prize_type: string; prize_value: number; expires_at: string }[]>([]);
  const [wheelSegments, setWheelSegments] = useState<any[]>([]);
  const [showWheel, setShowWheel] = useState(false);
  // Loyalty points
  const [loyaltyConfig, setLoyaltyConfig] = useState<{ is_enabled: boolean; points_per_real: number; points_expiry_days: number; wheel_enabled: boolean } | null>(null);
  const [loyaltyTiers, setLoyaltyTiers] = useState<any[]>([]);
  const [showLoyaltyScreen, setShowLoyaltyScreen] = useState(false);
  const [earnedPoints, setEarnedPoints] = useState(0);
  const [loyaltyTotalPoints, setLoyaltyTotalPoints] = useState(0);
  const [wonPrize, setWonPrize] = useState<any>(null);
  const [wonCouponCode, setWonCouponCode] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CartItem[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [selectedSeller, setSelectedSeller] = useState<string>("");
  const [loadingSellers, setLoadingSellers] = useState(false);
  const [finalizingSale, setFinalizingSale] = useState(false);
  const [saleResult, setSaleResult] = useState<{ tiny_order_id?: string; tiny_order_number?: string; sale_id?: string } | null>(null);
  const [emittingNfce, setEmittingNfce] = useState(false);
  const [nfceResult, setNfceResult] = useState<any>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [rfmMatches, setRfmMatches] = useState<any[]>([]);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [installments, setInstallments] = useState("1");
  const [multiInstallments, setMultiInstallments] = useState("1");
  const [cashReceived, setCashReceived] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountType, setDiscountType] = useState<"value" | "percent">("value");

  // Cash register gate
  const [hasOpenRegister, setHasOpenRegister] = useState<boolean | null>(null);
  const [checkingRegister, setCheckingRegister] = useState(true);

  // Notification counters
  const [unreadWhatsApp, setUnreadWhatsApp] = useState(0);
  const [newWhatsApp, setNewWhatsApp] = useState(0);
  const [unreadTeamChat, setUnreadTeamChat] = useState(0);
  const [pendingReturns, setPendingReturns] = useState(0);

  const subtotal = cart.reduce((s, item) => s + item.price * item.quantity, 0);
  const totalItems = cart.reduce((s, item) => s + item.quantity, 0);
  const parsedDiscount = parseFloat((discount || "0").replace(',', '.')) || 0;
  const discountValue = discountType === "percent"
    ? subtotal * (parsedDiscount / 100)
    : parsedDiscount;
  const totalWithDiscount = Math.max(0, subtotal - discountValue);

  // Check if cash register is open
  useEffect(() => {
    checkCashRegister();
  }, [storeId]);

  const checkCashRegister = async () => {
    setCheckingRegister(true);
    try {
      const { data, error } = await supabase
        .from('pos_cash_registers')
        .select('id')
        .eq('store_id', storeId)
        .eq('status', 'open')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setHasOpenRegister(!!data);
    } catch (e) {
      console.error(e);
      setHasOpenRegister(false);
    } finally {
      setCheckingRegister(false);
    }
  };

  // Debounce timer for Realtime notifications
  const notifDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load notification counts with Realtime + debounce
  useEffect(() => {
    if (!hasOpenRegister) return;
    loadNotifications();

    // Subscribe to whatsapp_messages changes with debounce to prevent query storms
    const debouncedLoad = () => {
      if (notifDebounceRef.current) clearTimeout(notifDebounceRef.current);
      notifDebounceRef.current = setTimeout(loadNotifications, 5000);
    };

    const channel = supabase
      .channel("pos-dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, () => {
        debouncedLoad();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_finished_conversations" }, () => {
        debouncedLoad();
      })
      .subscribe();

    return () => {
      if (notifDebounceRef.current) clearTimeout(notifDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [hasOpenRegister]);

  const loadNotifications = async () => {
    try {
      // Use RPC to calculate counts directly in the database (instead of fetching 72k+ rows)
      const { data, error } = await supabase.rpc('get_conversation_counts');

      if (error) {
        console.error('RPC get_conversation_counts error:', error);
        return;
      }

      if (data && data.length > 0) {
        setUnreadWhatsApp(Number(data[0].awaiting_count) || 0);
        setNewWhatsApp(Number(data[0].new_count) || 0);
      }

      // Team chat unread count from localStorage
      const storedUnread = parseInt(localStorage.getItem('team_chat_unread') || '0', 10);
      setUnreadTeamChat(storedUnread);
    } catch (e) {
      console.error('Notification load error:', e);
    }
  };

  // Use preloaded sellers if available, otherwise load from edge function
  useEffect(() => {
    if (preloadedSellers && preloadedSellers.length > 0) {
      setSellers(preloadedSellers);
      setLoadingSellers(false);
      return;
    }
    if (sellersPreloaded && preloadedSellers?.length === 0) {
      setSellers([]);
      setLoadingSellers(false);
      return;
    }
    if (!hasOpenRegister) return;
    // Fallback: load sellers ourselves if not preloaded
    const loadSellers = async () => {
      setLoadingSellers(true);
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-sellers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
          body: JSON.stringify({ store_id: storeId }),
        });
        const data = await resp.json();
        if (data.success) setSellers(data.sellers || []);
      } catch (e) {
        console.error('Error loading sellers:', e);
      } finally {
        setLoadingSellers(false);
      }
    };
    loadSellers();
  }, [storeId, hasOpenRegister, preloadedSellers, sellersPreloaded]);

  const loadPaymentMethods = useCallback(async () => {
    if (paymentMethods.length > 0) return;
    setLoadingPayments(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ store_id: storeId }),
      });
      const data = await resp.json();
      if (data.success && data.methods?.length > 0) {
        setPaymentMethods(data.methods);
      } else {
        // Fallback: load directly from DB cache
        const { data: cached } = await supabase
          .from('pos_payment_methods')
          .select('id, name')
          .eq('store_id', storeId)
          .eq('is_active', true)
          .order('sort_order');
        if (cached && cached.length > 0) {
          setPaymentMethods(cached);
        }
      }
    } catch (e) {
      console.error('Error loading payment methods:', e);
      // Fallback on network error too
      try {
        const { data: cached } = await supabase
          .from('pos_payment_methods')
          .select('id, name')
          .eq('store_id', storeId)
          .eq('is_active', true)
          .order('sort_order');
        if (cached && cached.length > 0) {
          setPaymentMethods(cached);
        }
      } catch {}
    } finally {
      setLoadingPayments(false);
    }
  }, [storeId, paymentMethods.length]);

  useEffect(() => {
    if (step === "payment") loadPaymentMethods();
  }, [step, loadPaymentMethods]);

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      const newQty = Math.max(1, item.quantity + delta);
      return { ...item, quantity: newQty };
    }));
  };

  const removeItem = (id: string) => setCart(prev => prev.filter(item => item.id !== id));

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-search with debounce when typing
  useEffect(() => {
    if (!barcodeInput.trim() || barcodeInput.trim().length < 3) {
      setSearchResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      handleBarcodeScan(barcodeInput.trim());
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [barcodeInput, storeId]);

  const handleBarcodeScan = async (term?: string) => {
    const query = term || barcodeInput.trim();
    if (!query) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const isBarcode = /^\d{8,14}$/.test(query);

      if (isBarcode) {
        // Barcode: first try local DB by exact barcode OR sku
        const { data } = await supabase
          .from('pos_products')
          .select('*')
          .eq('store_id', storeId)
          .or(`barcode.eq.${query},sku.eq.${query}`)
          .eq('is_active', true)
          .limit(10);

        if (data && data.length > 0) {
          // Found in cache — use it but also fetch real-time stock from Tiny API in background
          const products = data.map(mapDbProduct);
          if (products.length === 1) {
            addToCart(products[0]);
            setBarcodeInput("");
          } else {
            setSearchResults(products);
          }
          // Fetch real-time stock in background for found products
          fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-search-product`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify({ store_id: storeId, gtin: query }),
          }).then(r => r.json()).then(apiData => {
            if (apiData.success && apiData.products?.length > 0) {
              // Update stock in cache
              for (const ap of apiData.products) {
                supabase.from('pos_products')
                  .update({ stock: ap.stock, barcode: ap.barcode || query })
                  .eq('store_id', storeId)
                  .eq('sku', ap.sku)
                  .then(() => {});
              }
              // Update cart with real stock
              setCart(prev => prev.map(item => {
                const match = apiData.products.find((ap: any) => ap.sku === item.sku);
                return match ? { ...item, stock: match.stock } : item;
              }));
            }
          }).catch(() => {});
        } else {
          // Not in cache — fetch from Tiny API (returns stock)
          const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-search-product`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify({ store_id: storeId, gtin: query }),
          });
          const apiData = await resp.json();
          if (apiData.success && apiData.products.length > 0) {
            if (apiData.products.length === 1) {
              addToCart(apiData.products[0]);
              setBarcodeInput("");
            } else {
              setSearchResults(apiData.products);
            }
          } else {
            toast.error("Produto não encontrado");
          }
        }
      } else {
        // Text search: local DB with ilike (trigram index)
        const { data } = await supabase
          .from('pos_products')
          .select('*')
          .eq('store_id', storeId)
          .eq('is_active', true)
          .or(`name.ilike.%${query}%,sku.ilike.%${query}%,barcode.ilike.%${query}%`)
          .order('name')
          .limit(20);

        if (data && data.length > 0) {
          setSearchResults(data.map(mapDbProduct));
        } else {
          setSearchResults([]);
        }
      }
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setSearching(false);
    }
  };

  const mapDbProduct = (row: any): CartItem => ({
    id: `${row.tiny_id}-${row.sku}-${row.variant}`,
    tiny_id: row.tiny_id,
    sku: row.sku || '',
    name: row.name,
    variant: row.variant || '',
    size: row.size,
    category: row.category,
    price: parseFloat(row.price || '0'),
    quantity: 1,
    barcode: row.barcode || '',
    stock: parseFloat(row.stock || '0'),
  });

  const addToCart = (product: any) => {
    const cartId = `${product.tiny_id}-${product.sku}-${product.variant}`;
    setCart(prev => {
      const existing = prev.find(item => item.id === cartId);
      if (existing) {
        return prev.map(item =>
          item.id === cartId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, {
        id: cartId,
        tiny_id: product.tiny_id,
        sku: product.sku,
        name: product.name,
        variant: product.variant || '',
        size: product.size,
        category: product.category,
        price: product.price,
        quantity: 1,
        barcode: product.barcode || '',
        stock: product.stock,
      }];
    });
    setSearchResults([]);
    setBarcodeInput("");
  };

  const searchCustomerByTerm = async () => {
    if (!customerSearch.trim()) return;
    setSearchingCustomer(true);
    setRfmMatches([]);
    try {
      const term = customerSearch.trim();
      // Search POS customers
      const { data: posData } = await supabase
        .from('pos_customers')
        .select('*')
        .or(`cpf.ilike.%${term}%,name.ilike.%${term}%,whatsapp.ilike.%${term}%`)
        .limit(10);
      setCustomerResults(posData || []);

      // Also search zoppy_customers (RFM) by phone or name
      const phoneTerm = term.replace(/\D/g, '');
      const { data: rfmData } = await supabase
        .from('zoppy_customers')
        .select('*')
        .or(`phone.ilike.%${phoneTerm.length >= 4 ? phoneTerm : 'NOMATCH'}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(10);
      setRfmMatches(rfmData || []);
    } catch (e) {
      console.error(e);
    } finally {
      setSearchingCustomer(false);
    }
  };

  const importRfmCustomer = async (rfm: any) => {
    const name = `${rfm.first_name || ''} ${rfm.last_name || ''}`.trim();
    const phone = rfm.phone?.replace(/\D/g, '') || '';
    try {
      // Check if customer already exists by phone or email
      let existing: any = null;
      if (phone.length >= 8) {
        const { data } = await supabase
          .from('pos_customers')
          .select('*')
          .ilike('whatsapp', `%${phone.slice(-8)}%`)
          .limit(1)
          .maybeSingle();
        existing = data;
      }
      if (!existing && rfm.email) {
        const { data } = await supabase
          .from('pos_customers')
          .select('*')
          .ilike('email', rfm.email)
          .limit(1)
          .maybeSingle();
        existing = data;
      }

      if (existing) {
        toast.success("Cliente já cadastrado — selecionado automaticamente!");
        setSelectedCustomer(existing);
        lookupCashback(existing);
      } else {
        const { data, error } = await supabase
          .from('pos_customers')
          .insert({
            name: name || 'Cliente RFM',
            whatsapp: rfm.phone || null,
            email: rfm.email || null,
            city: rfm.city || null,
            state: rfm.state || null,
          } as any)
          .select()
          .single();
        if (error) throw error;
        toast.success("Cliente importado da Matriz RFM!");
        setSelectedCustomer(data);
        lookupCashback(data);
      }
      setRfmMatches([]);
      setCustomerResults([]);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao importar cliente");
    }
  };

  // Lookup cashback from Zoppy AND internal cashback system + customer prizes
  const lookupCashback = async (customer: { whatsapp?: string; cpf?: string; name?: string; email?: string }) => {
    setCustomerCashback(null);
    setCustomerPrizes([]);
    const phone = customer.whatsapp?.replace(/\D/g, '');
    if (!phone) return;
    try {
      // Check all sources in parallel
      const [zoppyRes, internalRes, prizesRes] = await Promise.all([
        supabase
          .from('zoppy_customers')
          .select('coupon_code, coupon_amount, coupon_type, coupon_used, coupon_min_purchase, coupon_expiry_date')
          .ilike('phone', `%${phone.slice(-8)}%`)
          .eq('coupon_used', false)
          .not('coupon_code', 'is', null)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('internal_cashback')
          .select('coupon_code, cashback_amount, min_purchase, expires_at')
          .ilike('customer_phone', `%${phone.slice(-8)}%`)
          .eq('is_used', false)
          .gte('expires_at', new Date().toISOString())
          .order('cashback_amount', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('customer_prizes')
          .select('id, prize_label, coupon_code, prize_type, prize_value, expires_at')
          .ilike('customer_phone', `%${phone.slice(-8)}%`)
          .eq('is_redeemed', false)
          .gte('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }) as any,
      ]);

      // Set customer prizes
      if (prizesRes.data && prizesRes.data.length > 0) {
        setCustomerPrizes(prizesRes.data);
      }

      // Prefer internal cashback (higher priority), fallback to Zoppy
      if (internalRes.data) {
        setCustomerCashback({
          code: internalRes.data.coupon_code,
          amount: internalRes.data.cashback_amount,
          type: 'fixed_cart',
          min_purchase: internalRes.data.min_purchase,
          expiry_date: internalRes.data.expires_at,
        });
      } else if (zoppyRes.data && zoppyRes.data.coupon_code) {
        const isExpired = zoppyRes.data.coupon_expiry_date && new Date(zoppyRes.data.coupon_expiry_date) < new Date();
        if (!isExpired) {
          setCustomerCashback({
            code: zoppyRes.data.coupon_code,
            amount: zoppyRes.data.coupon_amount || 0,
            type: zoppyRes.data.coupon_type || 'fixed_cart',
            min_purchase: zoppyRes.data.coupon_min_purchase || 0,
            expiry_date: zoppyRes.data.coupon_expiry_date || '',
          });
        }
      }
    } catch (e) {
      console.error('Cashback lookup error:', e);
    }
  };

  // Load wheel segments and loyalty config for this store
  const loadWheelSegments = async () => {
    const { data } = await supabase
      .from('prize_wheel_segments')
      .select('*')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('sort_order') as any;
    setWheelSegments(data || []);
  };

  const loadLoyaltyConfig = async () => {
    const { data } = await supabase.from('loyalty_config').select('*').eq('store_id', storeId).maybeSingle() as any;
    if (data) setLoyaltyConfig(data);
    const { data: tiers } = await supabase.from('loyalty_prize_tiers').select('*').eq('store_id', storeId).eq('is_active', true).order('min_points') as any;
    setLoyaltyTiers(tiers || []);
  };

  useEffect(() => {
    if (hasOpenRegister) {
      loadWheelSegments();
      loadLoyaltyConfig();
    }
  }, [storeId, hasOpenRegister]);

  const finalizeSale = async () => {
    if (cart.length === 0) return;
    setFinalizingSale(true);
    try {
      let paymentMethodName = '';
      if (useMultiPayment && multiPayments.length > 0) {
        paymentMethodName = multiPayments.map(p => `${p.method_name} (R$${p.amount.toFixed(2)})`).join(' + ');
      } else {
        const selectedPaymentMethod = paymentMethods.find(m => m.id === selectedPayment);
        paymentMethodName = selectedPaymentMethod?.name || '';
      }
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-create-sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          store_id: storeId,
          seller_id: selectedSeller || undefined,
          tiny_seller_id: sellers.find(s => s.id === selectedSeller)?.tiny_seller_id || undefined,
          customer: selectedCustomer || undefined,
          items: cart.map(item => ({
            tiny_id: item.tiny_id,
            sku: item.sku,
            name: item.name,
            variant: item.variant,
            size: item.size,
            category: item.category,
            price: item.price,
            quantity: item.quantity,
            barcode: item.barcode,
          })),
          payment_method_id: useMultiPayment ? 'multi' : selectedPayment,
          payment_method_name: paymentMethodName,
          discount: discountValue > 0 ? discountValue : undefined,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        if (data.tiny_failed) {
          toast.warning("Venda salva localmente! Tiny ERP indisponível — sincronize depois manualmente.");
        } else {
          toast.success("Venda criada no Tiny ERP!");
        }
        setSaleResult(data);
        setStep("invoice");

        // Award loyalty points if enabled and customer identified
        if (loyaltyConfig?.is_enabled && selectedCustomer?.whatsapp) {
          const phone = selectedCustomer.whatsapp.replace(/\D/g, '');
          const points = Math.floor(totalWithDiscount * (loyaltyConfig.points_per_real || 0.1));
          if (points > 0) {
            setEarnedPoints(points);
            setShowLoyaltyScreen(true);

            // Upsert customer points
            const { data: existing } = await supabase
              .from('customer_loyalty_points')
              .select('*')
              .eq('customer_phone', phone)
              .eq('store_id', storeId)
              .maybeSingle() as any;

            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + (loyaltyConfig.points_expiry_days || 365));

            let newTotal = points;
            if (existing) {
              newTotal = existing.total_points + points;
              setLoyaltyTotalPoints(newTotal);
              await supabase.from('customer_loyalty_points').update({
                total_points: newTotal,
                lifetime_points: existing.lifetime_points + points,
                last_earn_at: new Date().toISOString(),
                expires_at: expiresAt.toISOString(),
              } as any).eq('id', existing.id);
            } else {
              newTotal = points;
              setLoyaltyTotalPoints(newTotal);
              await supabase.from('customer_loyalty_points').insert({
                customer_phone: phone,
                customer_name: selectedCustomer.name || null,
                store_id: storeId,
                total_points: points,
                lifetime_points: points,
                expires_at: expiresAt.toISOString(),
              } as any);
            }

            // Log the transaction
            await supabase.from('loyalty_points_log').insert({
              customer_phone: phone,
              store_id: storeId,
              points,
              type: 'earn',
              sale_id: data.sale_id || null,
              description: `Venda R$ ${totalWithDiscount.toFixed(2)}`,
            } as any);

            // Check if customer earned a prize tier (but DON'T redeem automatically)
            const eligibleTier = loyaltyTiers
              .filter(t => t.is_active && newTotal >= t.min_points)
              .sort((a: any, b: any) => b.min_points - a.min_points)[0];

            if (eligibleTier) {
              setWonPrize(eligibleTier);
              // Don't auto-redeem - let the customer choose
            }
          }
        }

        // Track category/brand goal progress
        try {
          const { data: activeGoals } = await supabase
            .from('pos_goals')
            .select('*')
            .eq('store_id', storeId)
            .eq('is_active', true)
            .in('goal_type', ['category_units', 'brand_units']);

          if (activeGoals && activeGoals.length > 0) {
            for (const goal of activeGoals) {
              let matchingQty = 0;
              for (const item of cart) {
                if (goal.goal_type === 'category_units' && item.category && item.category.toLowerCase() === (goal.goal_category || '').toLowerCase()) {
                  matchingQty += item.quantity;
                } else if (goal.goal_type === 'brand_units' && (item as any).brand && (item as any).brand.toLowerCase() === (goal.goal_brand || '').toLowerCase()) {
                  matchingQty += item.quantity;
                }
              }
              if (matchingQty > 0) {
                const sellerId = selectedSeller || null;
                const { data: existing } = await supabase
                  .from('pos_goal_progress' as any)
                  .select('*')
                  .eq('goal_id', goal.id)
                  .eq('seller_id', sellerId || '00000000-0000-0000-0000-000000000000')
                  .maybeSingle();

                if (existing) {
                  await supabase.from('pos_goal_progress' as any).update({
                    current_value: (existing as any).current_value + matchingQty,
                    last_sale_id: data.sale_id || null,
                    updated_at: new Date().toISOString(),
                  }).eq('id', (existing as any).id);
                } else {
                  await supabase.from('pos_goal_progress' as any).insert({
                    goal_id: goal.id,
                    seller_id: sellerId,
                    current_value: matchingQty,
                    last_sale_id: data.sale_id || null,
                  });
                }
              }
            }
          }
        } catch (e) {
          console.error('Goal tracking error:', e);
        }
      } else {
        toast.error(data.error || "Erro ao criar venda");
      }
    } catch (e) {
      toast.error("Erro ao finalizar venda");
    } finally {
      setFinalizingSale(false);
    }
  };

  const emitNfce = async () => {
    if (!saleResult?.tiny_order_id) return;
    setEmittingNfce(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-emit-nfce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          store_id: storeId,
          sale_id: saleResult.sale_id,
          tiny_order_id: saleResult.tiny_order_id,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setNfceResult(data);
        toast.success("NFC-e emitida!");
      } else {
        toast.error(data.error || "Erro ao emitir NFC-e");
      }
    } catch (e) {
      toast.error("Erro ao emitir NFC-e");
    } finally {
      setEmittingNfce(false);
    }
  };

  const resetSale = () => {
    setCart([]);
    setSelectedCustomer(null);
    setCustomerCashback(null);
    setCustomerPrizes([]);
    setSelectedPayment("");
    setSelectedSeller("");
    setStep("scan");
    setSaleResult(null);
    setNfceResult(null);
    setSearchResults([]);
    setCashReceived("");
    setInstallments("1");
    setMultiPayments([]);
    setUseMultiPayment(false);
    setMultiPaymentMethodId("");
    setMultiPaymentAmount("");
    setMultiInstallments("1");
    setDiscount("");
    setDiscountType("value");
    setShowWheel(false);
    setShowLoyaltyScreen(false);
    setWonPrize(null);
    setWonCouponCode("");
    setEarnedPoints(0);
  };

  const steps: { id: SaleStep; label: string; icon: typeof ScanBarcode }[] = [
    { id: "scan", label: "Produtos", icon: ScanBarcode },
    { id: "customer", label: "Cliente", icon: User },
    { id: "payment", label: "Pagamento", icon: CreditCard },
    { id: "invoice", label: "Nota Fiscal", icon: Receipt },
  ];

  const stepIndex = steps.findIndex(s => s.id === step);
  const selectedPaymentName = paymentMethods.find(m => m.id === selectedPayment)?.name || '';
  const cashChange = cashReceived ? Math.max(0, parseFloat(cashReceived) - totalWithDiscount) : 0;
  const multiPaymentsTotal = multiPayments.reduce((s, p) => s + p.amount, 0);

  // --- GATE: Cash register must be open ---
  if (checkingRegister) {
    return (
      <div className="flex-1 flex items-center justify-center text-pos-white/50">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Verificando caixa...
      </div>
    );
  }

  if (!hasOpenRegister) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-sm">
          <div className="h-20 w-20 mx-auto rounded-full bg-red-500/10 flex items-center justify-center">
            <Lock className="h-10 w-10 text-red-400" />
          </div>
          <h3 className="text-xl font-bold text-pos-white">Caixa Fechado</h3>
          <p className="text-pos-white/50">
            É necessário abrir o caixa antes de iniciar as vendas. Vá até a seção <strong className="text-pos-orange">Caixa</strong> para fazer a abertura.
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-pos-white/30">
            <Lock className="h-3 w-3" />
            Vendas bloqueadas até a abertura do caixa
          </div>
        </div>
      </div>
    );
  }

  // Seller gate: must select seller before proceeding
  if (!selectedSeller && sellers.length > 0 && !loadingSellers) {
    return (
      <POSSellerGate
        storeId={storeId}
        sellers={sellers}
        onSellerSelected={(id) => setSelectedSeller(id)}
        onClose={onCloseSalesView}
      />
    );
  }

  const totalNotifications = unreadWhatsApp + newWhatsApp + unreadTeamChat + pendingReturns;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Notification Dashboard */}
      {step === "scan" && (
        <div className="flex items-stretch gap-2 md:gap-3 px-3 md:px-4 pt-2 md:pt-3 pb-1 overflow-x-auto scrollbar-hide">
          {/* Aguardando resposta */}
          <button
            onClick={() => onNavigateToWhatsApp?.("unanswered")}
            className={cn(
            "flex-shrink-0 md:flex-shrink md:flex-1 flex items-center gap-2 md:gap-3 rounded-xl p-2 md:p-3 border transition-all min-w-[110px] text-left",
            unreadWhatsApp > 0
              ? "bg-green-500/10 border-green-500/30 cursor-pointer hover:bg-green-500/20"
              : "bg-gray-100 border-gray-200 cursor-pointer hover:bg-gray-200"
          )}>
            <div className={cn("p-1.5 md:p-2 rounded-lg", unreadWhatsApp > 0 ? "bg-green-500/20" : "bg-gray-200")}>
              <Phone className={cn("h-4 w-4 md:h-5 md:w-5", unreadWhatsApp > 0 ? "text-green-600" : "text-gray-400")} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Aguardando</p>
              <p className={cn("text-base md:text-lg font-bold leading-tight", unreadWhatsApp > 0 ? "text-green-600" : "text-gray-400")}>
                {unreadWhatsApp}
              </p>
              <p className="text-[10px] text-gray-400 hidden sm:block">sem resposta</p>
            </div>
          </button>

          {/* Novas conversas */}
          <button
            onClick={() => onNavigateToWhatsApp?.("new")}
            className={cn(
            "flex-shrink-0 md:flex-shrink md:flex-1 flex items-center gap-2 md:gap-3 rounded-xl p-2 md:p-3 border transition-all min-w-[110px] text-left",
            newWhatsApp > 0
              ? "bg-blue-500/10 border-blue-500/30 cursor-pointer hover:bg-blue-500/20"
              : "bg-gray-100 border-gray-200 cursor-pointer hover:bg-gray-200"
          )}>
            <div className={cn("p-1.5 md:p-2 rounded-lg", newWhatsApp > 0 ? "bg-blue-500/20" : "bg-gray-200")}>
              <Bell className={cn("h-4 w-4 md:h-5 md:w-5", newWhatsApp > 0 ? "text-blue-600" : "text-gray-400")} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Novas</p>
              <p className={cn("text-base md:text-lg font-bold leading-tight", newWhatsApp > 0 ? "text-blue-600" : "text-gray-400")}>
                {newWhatsApp}
              </p>
              <p className="text-[10px] text-gray-400 hidden sm:block">mensagens</p>
            </div>
          </button>

          <div className={cn(
            "flex-shrink-0 md:flex-shrink md:flex-1 flex items-center gap-2 md:gap-3 rounded-xl p-2 md:p-3 border transition-all min-w-[110px]",
            pendingReturns > 0
              ? "bg-orange-50 border-orange-300"
              : "bg-gray-100 border-gray-200"
          )}>
            <div className={cn("p-1.5 md:p-2 rounded-lg", pendingReturns > 0 ? "bg-orange-100" : "bg-gray-200")}>
              <RotateCcw className={cn("h-4 w-4 md:h-5 md:w-5", pendingReturns > 0 ? "text-orange-600" : "text-gray-400")} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Trocas</p>
              <p className={cn("text-base md:text-lg font-bold leading-tight", pendingReturns > 0 ? "text-orange-600" : "text-gray-400")}>
                {pendingReturns}
              </p>
              <p className="text-[10px] text-gray-400 hidden sm:block">solicitações</p>
            </div>
          </div>

          <div className={cn(
            "flex-shrink-0 md:flex-shrink md:flex-1 flex items-center gap-2 md:gap-3 rounded-xl p-2 md:p-3 border transition-all min-w-[110px]",
            unreadTeamChat > 0
              ? "bg-yellow-50 border-yellow-400"
              : "bg-gray-100 border-gray-200"
          )}>
            <div className={cn("p-1.5 md:p-2 rounded-lg", unreadTeamChat > 0 ? "bg-yellow-100" : "bg-gray-200")}>
              <MessageSquare className={cn("h-4 w-4 md:h-5 md:w-5", unreadTeamChat > 0 ? "text-yellow-600" : "text-gray-400")} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Chat</p>
              <p className={cn("text-base md:text-lg font-bold leading-tight", unreadTeamChat > 0 ? "text-yellow-600" : "text-gray-400")}>
                {unreadTeamChat}
              </p>
              <p className="text-[10px] text-gray-400 hidden sm:block">não lidas</p>
            </div>
          </div>
        </div>
      )}

      {/* Seller Welcome Banner */}
      {step === "scan" && selectedSeller && (
        <div className="px-4 pt-1 pb-1">
          <div className="flex items-center gap-3 rounded-xl bg-pos-orange/10 border border-pos-orange/30 px-4 py-2">
            <div className="h-8 w-8 rounded-full bg-pos-orange/20 flex items-center justify-center text-pos-orange font-bold text-sm">
              {sellers.find(s => s.id === selectedSeller)?.name?.charAt(0) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-pos-white">
                Olá, <span className="text-pos-orange font-bold">{sellers.find(s => s.id === selectedSeller)?.name}</span>! Boas vendas! 🔥
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-pos-orange">
              <Star className="h-3.5 w-3.5" />
              <span className="text-xs font-bold">Ranking</span>
            </div>
          </div>
        </div>
      )}

      {/* Seller selector + Step Navigation */}
      <div className="flex items-center gap-1 p-2 md:p-3 border-b border-gray-200 bg-white overflow-x-auto scrollbar-hide">
        {/* Seller */}
        <div className="mr-2 md:mr-3 flex-shrink-0">
          <Select value={selectedSeller} onValueChange={setSelectedSeller}>
            <SelectTrigger className="h-8 w-28 md:w-36 bg-gray-50 border-gray-300 text-gray-800 text-xs">
              <Users className="h-3 w-3 mr-1 text-orange-500" />
              <SelectValue placeholder="Vendedora" />
            </SelectTrigger>
            <SelectContent>
              {sellers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isActive = step === s.id;
          const isDone = i < stepIndex;
          return (
            <button
              key={s.id}
              onClick={() => setStep(s.id)}
              className={cn(
                "flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-shrink-0",
                isActive && "bg-pos-orange text-black shadow-md shadow-pos-orange/30",
                isDone && "bg-orange-100 text-orange-600",
                !isActive && !isDone && "text-gray-500 hover:bg-gray-100"
              )}
            >
              {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Step Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {step === "scan" && (
            <>
              <div className="p-2 md:p-4 border-b border-pos-orange/10 bg-pos-black">
                <div className="flex gap-1.5 md:gap-2">
                  <div className="relative flex-1">
                    <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-orange" />
                    <Input
                      placeholder="Código, SKU ou nome..."
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleBarcodeScan()}
                      className="pl-10 text-sm md:text-lg h-10 md:h-12 bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange focus:ring-pos-orange/30"
                      autoFocus
                    />
                  </div>
                  <Button variant="outline" size="icon" className="h-10 w-10 md:h-12 md:w-12 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10" onClick={() => setShowCamera(true)}>
                    <Camera className="h-5 w-5" />
                  </Button>
                  <Button className="h-10 md:h-12 px-3 md:px-6 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={() => handleBarcodeScan()} disabled={searching}>
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="p-4 border-b border-pos-orange/10 bg-pos-orange/5">
                  <p className="text-xs text-pos-orange mb-2 font-medium">Resultados da busca — clique para adicionar:</p>
                  <div className="space-y-1.5">
                    {searchResults.map((product, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 rounded-lg border border-pos-orange/20 bg-pos-black cursor-pointer hover:border-pos-orange transition-all" onClick={() => addToCart(product)}>
                        <Package className="h-4 w-4 text-pos-orange flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-pos-white truncate">{product.name}</p>
                          <div className="flex gap-2 text-[10px]">
                            <span className="text-pos-orange">{product.sku}</span>
                            {product.variant && <span className="text-pos-white/50">{product.variant}</span>}
                            {product.stock !== undefined && <span className="text-pos-white/40">Est: {product.stock}</span>}
                          </div>
                        </div>
                        <span className="font-bold text-sm text-pos-orange">R$ {product.price.toFixed(2)}</span>
                        <Plus className="h-4 w-4 text-pos-orange" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-2">
                  {cart.length === 0 ? (
                    <div className="text-center py-20 text-pos-white/40">
                      <ScanBarcode className="h-16 w-16 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-medium">Nenhum produto adicionado</p>
                      <p className="text-sm mt-1">Bipe um código de barras, SKU ou busque pelo nome</p>
                    </div>
                  ) : cart.map(item => (
                    <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-pos-orange/10 bg-pos-white/5 hover:border-pos-orange/30 transition-all">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-pos-orange/10">
                        <Package className="h-5 w-5 text-pos-orange" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate text-pos-white">{item.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge className="text-[10px] bg-pos-orange/20 text-pos-orange border-pos-orange/30">{item.sku}</Badge>
                          {item.variant && <span className="text-xs text-pos-white/50">{item.variant}</span>}
                          {item.size && <span className="text-xs text-pos-white/40">Tam: {item.size}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7 border-pos-white/20 text-pos-white hover:bg-pos-white/10" onClick={() => updateQuantity(item.id, -1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-bold text-sm text-pos-orange">{item.quantity}</span>
                        <Button variant="outline" size="icon" className="h-7 w-7 border-pos-white/20 text-pos-white hover:bg-pos-white/10" onClick={() => updateQuantity(item.id, 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-right min-w-[80px]">
                        <p className="font-bold text-sm text-pos-white">R$ {(item.price * item.quantity).toFixed(2)}</p>
                        {item.quantity > 1 && <p className="text-[10px] text-pos-white/40">{item.quantity}x R$ {item.price.toFixed(2)}</p>}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => removeItem(item.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}

                  {/* Cross-sell suggestions */}
                  {cart.length > 0 && (
                    <POSCrossSellSuggestions storeId={storeId} cart={cart} onAddToCart={addToCart} />
                  )}
                </div>
              </ScrollArea>
            </>
          )}

          {step === "customer" && (
            <div className="p-6 space-y-6 overflow-auto">
              <div>
                <h2 className="text-lg font-bold mb-1 text-pos-white">Identificação do Cliente</h2>
                <p className="text-sm text-pos-white/50">Busque pelo CPF ou cadastre um novo cliente</p>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Buscar por CPF, nome ou telefone..."
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchCustomerByTerm()}
                  className="h-12 bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30 focus:border-pos-orange"
                />
                <Button className="h-12 gap-2 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={searchCustomerByTerm} disabled={searchingCustomer}>
                  {searchingCustomer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
                <Button className="h-12 gap-2 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={() => setShowCustomerForm(true)}>
                  <Plus className="h-4 w-4" /> Novo
                </Button>
              </div>
              {customerResults.length > 0 && !selectedCustomer && (
                <div className="space-y-2">
                  <p className="text-xs text-pos-orange font-medium">Clientes cadastrados:</p>
                  {customerResults.map(c => (
                    <div key={c.id} className="cursor-pointer rounded-lg border border-pos-orange/20 bg-pos-white/5 p-3 hover:border-pos-orange transition-all" onClick={() => { setSelectedCustomer(c); lookupCashback(c); }}>
                      <p className="font-medium text-pos-white">{c.name || 'Sem nome'}</p>
                      <div className="flex gap-3 text-xs text-pos-white/50 mt-1">
                        {c.cpf && <span>CPF: {c.cpf}</span>}
                        {c.whatsapp && <span>WhatsApp: {c.whatsapp}</span>}
                        {c.email && <span>{c.email}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* RFM Matches */}
              {rfmMatches.length > 0 && !selectedCustomer && (
                <div className="space-y-2">
                  <p className="text-xs text-cyan-400 font-medium flex items-center gap-1"><Star className="h-3 w-3" /> Encontrado na Matriz RFM:</p>
                  {rfmMatches.map(rfm => (
                    <div key={rfm.id} className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-pos-white">{rfm.first_name} {rfm.last_name}</p>
                          <div className="flex gap-3 text-xs text-pos-white/50 mt-1">
                            {rfm.phone && <span>Tel: {rfm.phone}</span>}
                            {rfm.email && <span>{rfm.email}</span>}
                            {rfm.rfm_segment && <Badge className="text-[10px] bg-cyan-500/20 text-cyan-300 border-cyan-500/30">{rfm.rfm_segment}</Badge>}
                          </div>
                          <div className="flex gap-3 text-xs text-pos-white/40 mt-1">
                            <span>{rfm.total_orders || 0} pedidos</span>
                            <span>Total: R$ {(rfm.total_spent || 0).toFixed(2)}</span>
                          </div>
                        </div>
                        <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700 text-white text-xs gap-1" onClick={() => importRfmCustomer(rfm)}>
                          <Check className="h-3 w-3" /> Usar este
                        </Button>
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-pos-white/30">Ou cadastre um novo cliente clicando em "Novo"</p>
                </div>
              )}

              {selectedCustomer ? (
                <>
                  <div className="rounded-xl border-2 border-pos-orange/50 bg-pos-orange/10 p-4 flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-pos-orange/20 flex items-center justify-center">
                      <Check className="h-5 w-5 text-pos-orange" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-pos-white">{selectedCustomer.name}</p>
                      {selectedCustomer.cpf && <p className="text-sm text-pos-white/50">CPF: {selectedCustomer.cpf}</p>}
                    </div>
                    <Button variant="ghost" size="sm" className="text-pos-white/70 hover:text-pos-orange hover:bg-pos-orange/10" onClick={() => { setSelectedCustomer(null); setCustomerResults([]); setRfmMatches([]); setCustomerCashback(null); }}>Trocar</Button>
                  </div>

                  {/* Incomplete data incentive */}
                  {(() => {
                    const missing: string[] = [];
                    if (!selectedCustomer.email) missing.push('E-mail');
                    if (!selectedCustomer.whatsapp) missing.push('WhatsApp');
                    if (!selectedCustomer.cpf) missing.push('CPF');
                    if (!selectedCustomer.cep) missing.push('CEP');
                    if (!selectedCustomer.address) missing.push('Endereço');
                    if (!selectedCustomer.city) missing.push('Cidade');
                    if (!selectedCustomer.gender) missing.push('Gênero');
                    if (!selectedCustomer.shoe_size) missing.push('Calçado');
                    if (!selectedCustomer.age_range) missing.push('Faixa etária');
                    if (!selectedCustomer.preferred_style) missing.push('Estilo');
                    if (missing.length === 0) return null;
                    const points = missing.length * 2;
                    return (
                      <div className="rounded-xl border-2 border-pos-orange bg-pos-orange/20 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Star className="h-4 w-4 text-pos-orange" />
                          <p className="text-sm font-bold text-pos-orange">+{points} pts disponíveis!</p>
                        </div>
                        <p className="text-xs text-pos-black font-medium">
                          Complete o cadastro deste cliente para ganhar pontos extras! Faltam: <span className="font-bold text-pos-black">{missing.join(', ')}</span>
                        </p>
                        <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold text-xs gap-1" onClick={() => setShowCustomerForm(true)}>
                          <Plus className="h-3 w-3" /> Completar cadastro
                        </Button>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <p className="text-xs text-pos-white/40">* Pule esta etapa para NFC-e sem identificação.</p>
              )}

              {/* Discrete Benefits Bar */}
              {selectedCustomer && (customerCashback || customerPrizes.length > 0) && (
                <div className="space-y-2">
                  {/* Cashback - discrete suggestion */}
                  {customerCashback && (
                    <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2.5">
                      <div className="h-8 w-8 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                        <Tag className="h-4 w-4 text-green-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-green-400">Cashback</span>
                          <span className="font-mono text-xs font-bold text-green-300 bg-green-500/10 px-1.5 py-0.5 rounded">
                            {customerCashback.code}
                          </span>
                        </div>
                        <p className="text-[11px] text-pos-white/60 truncate">
                          {customerCashback.type === 'percent' 
                            ? `${customerCashback.amount}% off` 
                            : `R$ ${customerCashback.amount.toFixed(2)} off`}
                          {customerCashback.min_purchase > 0 && ` · min R$ ${customerCashback.min_purchase.toFixed(2)}`}
                          {customerCashback.expiry_date && ` · até ${new Date(customerCashback.expiry_date).toLocaleDateString('pt-BR')}`}
                        </p>
                      </div>
                      <span className="text-[10px] text-green-400/60 italic flex-shrink-0">sugerir</span>
                    </div>
                  )}

                  {/* Prizes - discrete list */}
                  {customerPrizes.map(p => (
                    <div key={p.id} className="flex items-center gap-3 rounded-lg border border-purple-500/30 bg-purple-500/5 px-3 py-2.5">
                      <div className="h-8 w-8 rounded-full bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                        <Gift className="h-4 w-4 text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-purple-400">{p.prize_label}</span>
                          <span className="font-mono text-xs font-bold text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded">
                            {p.coupon_code}
                          </span>
                        </div>
                        <p className="text-[11px] text-pos-white/60 truncate">
                          {p.prize_type === 'discount_percent' ? `${p.prize_value}% off` : 
                           p.prize_type === 'free_shipping' ? 'Frete grátis' :
                           `R$ ${p.prize_value.toFixed(2)} off`}
                          {` · até ${new Date(p.expires_at).toLocaleDateString('pt-BR')}`}
                        </p>
                      </div>
                      <span className="text-[10px] text-purple-400/60 italic flex-shrink-0">sugerir</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "payment" && (
            <div className="p-6 space-y-6 overflow-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold mb-1 text-pos-white">Forma de Pagamento</h2>
                  <p className="text-sm text-pos-white/50">Formas de pagamento do Tiny ERP</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-pos-white/50">Pagamento misto</span>
                  <Switch checked={useMultiPayment} onCheckedChange={(v) => { setUseMultiPayment(v); if (!v) setMultiPayments([]); }} />
                </div>
              </div>
              {loadingPayments ? (
                <div className="flex items-center justify-center py-12 text-pos-white/50">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando formas de pagamento do Tiny...
                </div>
              ) : !useMultiPayment ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {paymentMethods.map(method => {
                      const isSelected = selectedPayment === method.id;
                      const lowerName = method.name.toLowerCase();
                      let Icon = CreditCard;
                      if (lowerName.includes('dinheiro')) Icon = Banknote;
                      else if (lowerName.includes('pix')) Icon = QrCode;
                      else if (lowerName.includes('crediário') || lowerName.includes('crediario')) Icon = FileText;
                      return (
                        <div key={method.id} className={cn(
                          "cursor-pointer rounded-xl border-2 p-6 flex flex-col items-center justify-center gap-3 transition-all hover:shadow-lg",
                          isSelected ? "border-pos-orange bg-pos-orange/10 shadow-[0_0_20px_hsl(25_100%_50%/0.15)]" : "border-pos-white/10 bg-pos-white/5 hover:border-pos-orange/30"
                        )} onClick={() => setSelectedPayment(method.id)}>
                          <div className={cn("p-3 rounded-xl transition-colors", isSelected ? "bg-pos-orange text-pos-black" : "bg-pos-white/10 text-pos-white/60")}>
                            <Icon className="h-6 w-6" />
                          </div>
                          <span className={cn("font-medium text-sm text-center", isSelected ? "text-pos-orange" : "text-pos-white/70")}>{method.name}</span>
                        </div>
                      );
                    })}
                  </div>
                  {(selectedPaymentName.toLowerCase().includes('crédito') || selectedPaymentName.toLowerCase().includes('credito') || selectedPaymentName.toLowerCase().includes('crediário') || selectedPaymentName.toLowerCase().includes('crediario')) && (
                    <div className="space-y-3 p-4 rounded-xl bg-pos-white/5 border border-pos-orange/20">
                      <Label className="text-pos-white">Parcelas</Label>
                      <Select value={installments} onValueChange={setInstallments}>
                        <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                            <SelectItem key={n} value={String(n)}>{n}x de R$ {(totalWithDiscount / n).toFixed(2)}{n === 1 ? ' (à vista)' : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {selectedPaymentName.toLowerCase().includes('dinheiro') && (
                    <div className="space-y-3 p-4 rounded-xl bg-pos-white/5 border border-pos-orange/20">
                      <Label className="text-pos-white">Valor recebido</Label>
                      <Input type="number" value={cashReceived} onChange={e => setCashReceived(e.target.value)} placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30" />
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-pos-white/50">Troco:</span>
                        <span className="font-bold text-lg text-pos-orange">R$ {cashChange.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  {/* Multi-payment: add payment methods with amounts */}
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Select value={multiPaymentMethodId} onValueChange={setMultiPaymentMethodId}>
                        <SelectTrigger className="flex-1 bg-pos-white/5 border-pos-orange/30 text-pos-white">
                          <SelectValue placeholder="Forma de pagamento" />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentMethods.map(m => (
                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        value={multiPaymentAmount}
                        onChange={e => setMultiPaymentAmount(e.target.value)}
                        placeholder="Valor R$"
                        className="w-32 bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30"
                      />
                    </div>
                    {/* Installments for credit/crediário in multi-payment */}
                    {(() => {
                      const selectedMethodName = paymentMethods.find(m => m.id === multiPaymentMethodId)?.name?.toLowerCase() || '';
                      if (selectedMethodName.includes('crédito') || selectedMethodName.includes('credito') || selectedMethodName.includes('crediário') || selectedMethodName.includes('crediario')) {
                        return (
                          <Select value={multiInstallments} onValueChange={setMultiInstallments}>
                            <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white">
                              <SelectValue placeholder="Parcelas" />
                            </SelectTrigger>
                            <SelectContent>
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => {
                                const amt = parseFloat(multiPaymentAmount) || 0;
                                return (
                                  <SelectItem key={n} value={String(n)}>
                                    {n}x {amt > 0 ? `de R$ ${(amt / n).toFixed(2)}` : ''}{n === 1 ? ' (à vista)' : ''}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        );
                      }
                      return null;
                    })()}
                    <Button
                      className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold"
                      onClick={() => {
                        if (!multiPaymentMethodId || !multiPaymentAmount) return;
                        const method = paymentMethods.find(m => m.id === multiPaymentMethodId);
                        if (!method) return;
                        const inst = parseInt(multiInstallments) || 1;
                        setMultiPayments(prev => [...prev, {
                          method_id: multiPaymentMethodId,
                          method_name: inst > 1 ? `${method.name} ${inst}x` : method.name,
                          amount: parseFloat(multiPaymentAmount) || 0,
                        }]);
                        setMultiPaymentMethodId("");
                        setMultiPaymentAmount("");
                        setMultiInstallments("1");
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Adicionar
                    </Button>
                  </div>

                  {multiPayments.length > 0 && (
                    <div className="space-y-2">
                      {multiPayments.map((p, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-orange/20">
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-pos-orange" />
                            <span className="text-sm text-pos-white">{p.method_name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-pos-orange">R$ {p.amount.toFixed(2)}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300" onClick={() => setMultiPayments(prev => prev.filter((_, idx) => idx !== i))}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center justify-between p-3 rounded-lg bg-pos-orange/10 border border-pos-orange/30">
                        <span className="text-sm text-pos-white/70">Total informado:</span>
                        <span className={cn("font-bold text-lg", multiPaymentsTotal === totalWithDiscount ? "text-green-400" : multiPaymentsTotal < totalWithDiscount ? "text-red-400" : "text-pos-orange")}>
                          R$ {multiPaymentsTotal.toFixed(2)}
                        </span>
                      </div>
                      {multiPaymentsTotal !== totalWithDiscount && (
                        <p className="text-xs text-red-400">
                          {multiPaymentsTotal < totalWithDiscount
                            ? `Faltam R$ ${(totalWithDiscount - multiPaymentsTotal).toFixed(2)} para completar o total`
                            : `Excede o total em R$ ${(multiPaymentsTotal - totalWithDiscount).toFixed(2)}`}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Discount Section */}
              <div className="space-y-3 p-4 rounded-xl bg-pos-white/5 border border-pos-orange/20">
                <Label className="text-pos-white flex items-center gap-2">
                  <Tag className="h-4 w-4 text-pos-orange" /> Desconto
                </Label>
                <div className="flex gap-2">
                  <Select value={discountType} onValueChange={(v: "value" | "percent") => setDiscountType(v)}>
                    <SelectTrigger className="w-24 bg-pos-white/5 border-pos-orange/30 text-pos-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="value">R$</SelectItem>
                      <SelectItem value="percent">%</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={discount}
                    onChange={e => {
                      // Allow only digits, comma and dot
                      const val = e.target.value.replace(/[^0-9.,]/g, '');
                      setDiscount(val);
                    }}
                    placeholder={discountType === "percent" ? "Ex: 10" : "Ex: 50"}
                    className="flex-1 bg-pos-white/5 border-pos-orange/30 text-pos-white placeholder:text-pos-white/30"
                  />
                </div>
                {discountValue > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-pos-white/50">Desconto aplicado:</span>
                    <span className="font-bold text-red-400">-R$ {discountValue.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === "invoice" && (
            <div className="p-6 space-y-6 overflow-auto">
              <div className="rounded-xl border-2 border-pos-orange/50 bg-pos-orange/10 p-6 text-center space-y-4">
                <div className="h-16 w-16 mx-auto rounded-full bg-pos-orange/20 flex items-center justify-center">
                  <Check className="h-8 w-8 text-pos-orange" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-pos-white">Venda Finalizada!</h3>
                  <p className="text-pos-white/50 mt-1">
                    {saleResult?.tiny_order_number
                      ? `Pedido #${saleResult.tiny_order_number} criado no Tiny ERP`
                      : 'Pedido criado no Tiny ERP'}
                  </p>
                </div>
                <div className="text-2xl font-bold text-pos-orange">R$ {totalWithDiscount.toFixed(2)}</div>
                {discountValue > 0 && <p className="text-sm text-red-400">Desconto: -R$ {discountValue.toFixed(2)}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  className="h-14 gap-2 text-base border-2 border-pos-orange/30 bg-pos-white/5 text-pos-orange hover:bg-pos-orange/10"
                  variant="outline"
                  onClick={emitNfce}
                  disabled={emittingNfce || !!nfceResult}
                >
                  {emittingNfce ? <Loader2 className="h-5 w-5 animate-spin" /> : <Receipt className="h-5 w-5" />}
                  {nfceResult ? 'NFC-e Emitida ✓' : 'Emitir NFC-e'}
                </Button>
                {nfceResult?.invoice_pdf_url && (
                  <Button className="h-14 gap-2 text-base border-2 border-pos-orange/30 bg-pos-white/5 text-pos-orange hover:bg-pos-orange/10" variant="outline" onClick={() => window.open(nfceResult.invoice_pdf_url, '_blank')}>
                    <Printer className="h-5 w-5" /> Imprimir Nota
                  </Button>
                )}
                {loyaltyConfig?.wheel_enabled && wheelSegments.length > 0 && !showWheel && (
                  <Button
                    className="h-14 gap-2 text-base bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 text-white font-bold col-span-2 hover:from-yellow-500 hover:via-orange-600 hover:to-red-600 shadow-lg"
                    onClick={() => setShowWheel(true)}
                  >
                    🎰 Girar Roleta de Prêmios
                  </Button>
                )}
                <Button className="h-14 gap-2 text-base bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold col-span-2" onClick={resetSale}>
                  <ShoppingCart className="h-5 w-5" /> Nova Venda
                </Button>
              </div>

              {/* Loyalty Screen (Slot -> Summary -> Prize) */}
              {showLoyaltyScreen && (
                <POSLoyaltyScreen
                  open={showLoyaltyScreen}
                  pointsEarned={earnedPoints}
                  totalPoints={loyaltyTotalPoints}
                  tiers={loyaltyTiers}
                  wonPrize={wonPrize}
                  wonCouponCode={wonCouponCode}
                  customerName={selectedCustomer?.name}
                  onClose={() => {
                    setShowLoyaltyScreen(false);
                    resetSale();
                  }}
                  onRedeemPrize={async () => {
                    if (!wonPrize || !selectedCustomer?.whatsapp) return "";
                    const phone = selectedCustomer.whatsapp.replace(/\D/g, '');
                    const code = `FID-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                    
                    // Save prize
                    const prizeExpiry = new Date();
                    prizeExpiry.setDate(prizeExpiry.getDate() + 30);
                    await supabase.from('customer_prizes').insert({
                      customer_phone: phone,
                      customer_name: selectedCustomer.name || null,
                      customer_email: selectedCustomer.email || null,
                      store_id: storeId,
                      prize_label: wonPrize.prize_label,
                      prize_type: wonPrize.prize_type,
                      prize_value: wonPrize.prize_value,
                      coupon_code: code,
                      expires_at: prizeExpiry.toISOString(),
                      source: 'loyalty',
                    } as any);

                    // Deduct points
                    await supabase.from('customer_loyalty_points').update({
                      total_points: loyaltyTotalPoints - wonPrize.min_points,
                    } as any).eq('customer_phone', phone).eq('store_id', storeId);

                    await supabase.from('loyalty_points_log').insert({
                      customer_phone: phone,
                      store_id: storeId,
                      points: -wonPrize.min_points,
                      type: 'redeem',
                      description: `Prêmio: ${wonPrize.prize_label}`,
                    } as any);

                    setWonCouponCode(code);
                    return code;
                  }}
                />
              )}

              {/* Prize Wheel (events only) */}
              {showWheel && (
                <POSPrizeWheel
                  segments={wheelSegments}
                  storeId={storeId}
                  customerPhone={selectedCustomer?.whatsapp?.replace(/\D/g, '')}
                  customerName={selectedCustomer?.name}
                  customerEmail={selectedCustomer?.email}
                  onClose={() => setShowWheel(false)}
                />
              )}
            </div>
          )}
        </div>

        {/* Right: Cart Summary (desktop only) */}
        <div className="hidden md:flex w-[280px] border-l border-pos-orange/20 bg-pos-black flex-col">
          <div className="p-3 border-b border-pos-orange/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-pos-orange" />
                <span className="font-semibold text-sm text-pos-white">Resumo</span>
              </div>
              <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/30">{totalItems} itens</Badge>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1.5">
              {cart.map(item => (
                <div key={item.id} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-xs text-pos-white">{item.name}</p>
                    <p className="text-[10px] text-pos-white/40">{item.quantity}x R$ {item.price.toFixed(2)}</p>
                  </div>
                  <span className="font-semibold text-xs ml-2 text-pos-white">R$ {(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="border-t border-pos-orange/20 p-3 space-y-2">
            {selectedSeller && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <Users className="h-3 w-3" />{sellers.find(s => s.id === selectedSeller)?.name}
              </div>
            )}
            {selectedCustomer && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <User className="h-3 w-3" />{selectedCustomer.name}
              </div>
            )}
            {useMultiPayment && multiPayments.length > 0 ? (
              <div className="space-y-1">
                {multiPayments.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-pos-white/50">
                    <CreditCard className="h-3 w-3" />{p.method_name}: R$ {p.amount.toFixed(2)}
                  </div>
                ))}
              </div>
            ) : selectedPayment ? (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                <CreditCard className="h-3 w-3" />{selectedPaymentName}
              </div>
            ) : null}
            <Separator className="bg-pos-orange/20" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-pos-white/50">Subtotal</span>
              <span className="text-sm text-pos-white/50">R$ {subtotal.toFixed(2)}</span>
            </div>
            {discountValue > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-red-400">Desconto</span>
                <span className="text-sm text-red-400">-R$ {discountValue.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-pos-white">Total</span>
              <span className="font-bold text-lg text-pos-orange">R$ {totalWithDiscount.toFixed(2)}</span>
            </div>
            <Button
              className="w-full h-10 text-sm gap-2 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold"
              disabled={cart.length === 0 || finalizingSale}
              onClick={() => {
                if (step === "payment") {
                  finalizeSale();
                } else if (step === "invoice") {
                  resetSale();
                } else if (stepIndex < steps.length - 1) {
                  setStep(steps[stepIndex + 1].id);
                }
              }}
            >
              {finalizingSale ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Finalizando...</>
              ) : step === "payment" ? (
                <><Check className="h-4 w-4" /> Finalizar Venda</>
              ) : step === "invoice" ? (
                <><ShoppingCart className="h-4 w-4" /> Nova Venda</>
              ) : (
                <>Avançar <ChevronRight className="h-4 w-4" /></>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile: Fixed bottom cart bar */}
      <div className="md:hidden flex-shrink-0 border-t border-pos-orange/20 bg-pos-black p-2 safe-area-pb">
        <div className="flex items-center gap-3">
          {selectedSeller && (
            <div className="flex items-center gap-1 text-[10px] text-pos-white/50">
              <Users className="h-3 w-3" /> {sellers.find(s => s.id === selectedSeller)?.name}
            </div>
          )}
          <div className="flex-1" />
          <div className="text-right mr-2">
            <p className="text-[10px] text-pos-white/50">Subtotal</p>
            <p className="font-bold text-pos-white text-sm">Total <span className="text-pos-orange">R$ {totalWithDiscount.toFixed(2)}</span></p>
          </div>
          <Button
            className="h-10 px-4 text-sm gap-1 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold"
            disabled={cart.length === 0 || finalizingSale}
            onClick={() => {
              if (step === "payment") {
                finalizeSale();
              } else if (step === "invoice") {
                resetSale();
              } else if (stepIndex < steps.length - 1) {
                setStep(steps[stepIndex + 1].id);
              }
            }}
          >
            {finalizingSale ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : step === "payment" ? (
              <><Check className="h-4 w-4" /> Finalizar</>
            ) : step === "invoice" ? (
              <><ShoppingCart className="h-4 w-4" /> Nova</>
            ) : (
              <>Avançar <ChevronRight className="h-4 w-4" /></>
            )}
          </Button>
        </div>
      </div>

      {/* Camera Overlay (not Dialog - avoids DOM conflicts with html5-qrcode) */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-pos-black/95 flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-pos-white font-bold flex items-center gap-2">
                <Camera className="h-5 w-5 text-pos-orange" /> Scanner de Código de Barras
              </h3>
            </div>
            <POSBarcodeScanner
              onScan={(code) => {
                setBarcodeInput(code);
                handleBarcodeScan(code);
              }}
              onClose={() => setShowCamera(false)}
            />
          </div>
        </div>
      )}

      {/* Customer Form Dialog */}
      <POSCustomerForm
        open={showCustomerForm}
        onOpenChange={setShowCustomerForm}
        existingCustomer={selectedCustomer}
        onSaved={async (customer) => {
          // Fetch full customer data to preserve all fields
          const { data } = await supabase
            .from('pos_customers')
            .select('*')
            .eq('id', customer.id)
            .single();
          setSelectedCustomer(data || customer);
          setShowCustomerForm(false);
        }}
      />
    </div>
  );
}
