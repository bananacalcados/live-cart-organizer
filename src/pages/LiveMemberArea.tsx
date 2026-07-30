import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  History,
  Loader2,
  Lock,
  LogOut,

  MessageCircle,
  QrCode,
  ShoppingBag,
  Timer,
  Trash2,
} from "lucide-react";
import {
  EventPrizeWheelDialog,
  PublicWheel,
  useEventPrizeWheels,
} from "@/components/prize/EventPrizeWheelDialog";
import {
  StepPayment,
  type CustomerFormData,
  type InstallmentConfig,
} from "@/components/checkout/PaymentSection";


type Step = "phone" | "name" | "signup_otp" | "confirm" | "onboarding" | "area";
type OnboardStep = "address" | "shipping" | "cpf" | "email";

interface ShippingOption {
  id: string;
  label: string;
  description: string;
  cost: number;
  delivery_days?: number | null;
}



interface MemberState {
  token: string;
  event: { id: string; name: string; is_live_broadcasting?: boolean } | null;
  name: string | null;
  phone: string;
  otpUnlocked: boolean;
  hasDetails: boolean;
  details: any;
  payDetails?: any;
  onboarding?: { address: boolean; shipping: boolean; cpf: boolean; email: boolean };
  onboardingComplete?: boolean;
  order: {
    id: string;
    stage: string;
    products: any[];
    subtotal?: number;
    discount?: number;
    shipping_pending?: boolean;
    shipping_cost: number;
    shipping_method?: string | null;
    shipping_label?: string | null;
    free_shipping?: boolean;
    total: number;

    pix_discount_percent?: number;
    pix_discount?: number;
    pix_total?: number;
    is_paid: boolean;
    confirmed_at: string | null;
    payment_window_expires_at: string | null;
    checkout_url: string;
  } | null;


  history?: {
    id: string;
    event_name: string | null;
    created_at: string;
    is_paid: boolean;
    total: number;
    items: { title: string; variant?: string; quantity: number; price: number }[];
  }[];
}

const TOKEN_KEY = "live_member_token";
const ANSWERED_KEY = "live_member_confirm_answered";
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function callApi(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("live-member-area", { body: payload });
  if (error) {
    // A mensagem real vem no corpo da resposta; sem isso o usuário só vê "non-2xx".
    let detail = error.message;
    try {
      const ctx = (error as any)?.context;
      if (ctx?.text) {
        const raw = await ctx.text();
        const parsed = JSON.parse(raw);
        if (parsed?.error) detail = parsed.error;
      }
    } catch {
      /* mantém a mensagem padrão */
    }
    throw new Error(detail);
  }
  return data as any;
}


export default function LiveMemberArea() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [event, setEvent] = useState<{ id: string; name: string; is_live: boolean } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<MemberState | null>(null);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [activeWheel, setActiveWheel] = useState<PublicWheel | null>(null);
  const pollRef = useRef<number | null>(null);

  /** Onboarding pós-confirmação (endereço → envio → CPF → e-mail). */
  const [onboardStep, setOnboardStep] = useState<OnboardStep>("address");
  const [addr, setAddr] = useState<any>({});
  const [cepLoading, setCepLoading] = useState(false);
  const [shipOptions, setShipOptions] = useState<ShippingOption[]>([]);
  const [shipLoading, setShipLoading] = useState(false);
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");

  /** Assinatura dos itens do pedido, pra avisar quando a vendedora anota algo novo. */
  const itemsSigRef = useRef<string | null>(null);


  /** Roletas de prêmio disponíveis para esta cliente neste evento. */
  const { wheels, refresh: refreshWheels } = useEventPrizeWheels(
    state?.phone || null,
    state?.event?.id || null,
  );
  const availableWheels = wheels.filter((w) => w.eligible && w.spins_used < w.max_spins);



  /** SEO da página pública (link fica na bio do Instagram). */
  useEffect(() => {
    const title = "Minha Área | Banana Calçados";
    const description =
      "Acesse sua área de cliente Banana Calçados: confira os itens anotados na Live, confirme seu pedido e pague com PIX.";
    document.title = title;

    const upsert = (selector: string, attrs: Record<string, string>) => {
      let el = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
      if (!el) {
        el = document.createElement(selector.startsWith("link") ? "link" : "meta") as any;
        document.head.appendChild(el!);
      }
      Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
    };

    upsert('meta[name="description"]', { name: "description", content: description });
    upsert('meta[name="robots"]', { name: "robots", content: "index, follow" });
    upsert('meta[property="og:title"]', { property: "og:title", content: title });
    upsert('meta[property="og:description"]', { property: "og:description", content: description });
    upsert('meta[property="og:type"]', { property: "og:type", content: "website" });
    upsert('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
    upsert('link[rel="canonical"]', {
      rel: "canonical",
      href: "https://checkout.bananacalcados.com.br/minha-area",
    });
  }, []);


  /** Volta para a página anterior (a live / link de origem). */
  const backToLive = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = "https://www.instagram.com/bananacalcados/";
  };

  /** Sai da área de membros e volta para a etapa de WhatsApp. */
  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    if (pollRef.current) window.clearInterval(pollRef.current);
    setState(null);
    setPhone("");
    setName("");
    setOtp("");
    setOtpOpen(false);
    setDetailsOpen(false);
    setStep("phone");
    toast.success("Você saiu da área de membros");
  };

  const formatPhone = (value: string) => {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };


  /** Assinatura simples dos itens do pedido pra detectar mudanças vindas da live. */
  const itemsSignature = (order: any) =>
    order
      ? `${order.id}:${(order.products || [])
          .map((p: any) => `${p.id ?? p.title}x${p.quantity ?? 1}`)
          .join("|")}`
      : "none";

  /**
   * A confirmação é pedida UMA ÚNICA VEZ por pedido. Depois que a cliente
   * responde (confirmou ou recusou), só volta a aparecer se novos itens forem
   * anotados na live.
   */
  const readAnswered = (): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(ANSWERED_KEY) || "{}");
    } catch {
      return {};
    }
  };
  const markAnswered = (order: any) => {
    const map = readAnswered();
    map[order.id] = itemsSignature(order);
    localStorage.setItem(ANSWERED_KEY, JSON.stringify(map));
  };
  const needsConfirm = (data: any) => {
    const o = data?.order;
    if (!o || o.is_paid || !o.products?.length) return false;
    // O servidor é a fonte da verdade: só pede confirmação de novo se os itens mudaram.
    if (typeof o.needs_confirm === "boolean") return o.needs_confirm;
    if (o.confirmed_at) return false;
    return readAnswered()[o.id] !== itemsSignature(o);
  };
  const needsOnboarding = (data: any) =>
    !!data?.order && !data.order.is_paid && !data.onboardingComplete;

  /** Decide em que etapa a cliente deve cair depois de carregar o estado. */
  const routeFor = (data: any): Step => {
    if (needsConfirm(data)) return "confirm";
    if (data?.order?.confirmed_at && needsOnboarding(data)) return "onboarding";
    return "area";
  };

  /** Primeira etapa do onboarding ainda pendente. */
  const firstPendingOnboard = (data: any): OnboardStep => {
    const ob = data?.onboarding || {};
    if (!ob.address) return "address";
    if (!ob.shipping) return "shipping";
    if (!ob.cpf) return "cpf";
    return "email";
  };

  const hydrateForms = (data: any) => {
    const d = data?.details || {};
    if (!d.masked) {
      setAddr({
        cep: d.cep || "",
        address: d.address || "",
        address_number: d.address_number || "",
        complement: d.complement || "",
        neighborhood: d.neighborhood || "",
        city: d.city || "",
        state: d.state || "",
      });
      setCpf(d.cpf || "");
      setEmail(d.email || "");
    }
  };

  const applyState = useCallback(
    (data: any) => {
      if (!data?.ok) return;
      setState(data as MemberState);
      localStorage.setItem(TOKEN_KEY, data.token);
      itemsSigRef.current = itemsSignature(data.order);
      hydrateForms(data);
      const next = routeFor(data);
      if (next === "onboarding") setOnboardStep(firstPendingOnboard(data));
      setStep(next);
    },
    [],
  );

  // Bootstrap + sessão salva
  useEffect(() => {
    (async () => {
      try {
        const boot = await callApi({ action: "bootstrap" });
        if (!boot?.ok) {
          setNotFound(true);
          return;
        }
        setEvent(boot.event);
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          const st = await callApi({ action: "state", token });
          if (st?.ok) applyState(st);
          else localStorage.removeItem(TOKEN_KEY);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [applyState]);

  /**
   * Atualização em tempo quase-real: a vendedora anota o item na live e a cliente
   * vê aparecer sozinho, sem recarregar. Polling curto (6s) enquanto a aba está
   * visível, pausado quando ela sai da aba, e refresh imediato ao voltar.
   */
  const refreshState = useCallback(
    async (token: string, silent = true) => {
      try {
        if (!silent) setSyncing(true);
        const st = await callApi({ action: "state", token });
        if (!st?.ok) return;
        setState(st);

        const sig = itemsSignature(st.order);
        const had = itemsSigRef.current;
        if (had && had !== sig && st.order?.products?.length) {
          const prevCount = had.split("|").filter(Boolean).length;
          const nextCount = sig.split("|").filter(Boolean).length;
          if (had !== "none" && nextCount > prevCount) {
            toast.success("Novo item adicionado ao seu pedido 🛍️");
          }
        }
        itemsSigRef.current = sig;

        // Só interrompe a navegação quando ela está parada na área principal.
        if (needsConfirm(st)) setStep((s) => (s === "area" ? "confirm" : s));
      } catch {
        /* silencioso */
      } finally {
        setSyncing(false);
      }
    },
    [],
  );


  useEffect(() => {
    const token = state?.token;
    if (step !== "area" || !token) return;

    const start = () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(() => refreshState(token), 6000);
    };
    const stop = () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshState(token, false);
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [step, state?.token, refreshState]);


  // Contador da janela de pagamento
  useEffect(() => {
    const exp = state?.order?.payment_window_expires_at;
    if (!exp || state?.order?.is_paid) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.floor((new Date(exp).getTime() - Date.now()) / 1000)));
    tick();
    const i = window.setInterval(tick, 1000);
    return () => window.clearInterval(i);
  }, [state?.order?.payment_window_expires_at, state?.order?.is_paid]);

  const enter = async (withName?: string, code?: string) => {
    setBusy(true);
    try {
      const res = await callApi({
        action: "enter",
        phone,
        name: withName || name.trim() || undefined,
        otp: code || undefined,
      });
      if (!res?.ok) {
        // Cadastro novo sem pedidos: confirma o WhatsApp uma única vez.
        if (res?.needsOtp) {
          setStep("signup_otp");
          if (code) toast.error(res?.error || "Código incorreto");
          return;
        }
        toast.error(res?.error || "Não foi possível entrar");
        return;
      }
      if (res.needsName) {
        setStep("name");
        return;
      }
      applyState(res);
    } catch (e: any) {
      toast.error(e.message || "Erro ao entrar");
    } finally {
      setBusy(false);
    }
  };


  /** Aplica a resposta do servidor sem perder o histórico (respostas rápidas o omitem). */
  const mergeState = (res: any) =>
    setState((prev: any) => ({ ...res, history: res.history ?? prev?.history }));

  const act = async (payload: Record<string, unknown>, opts: { quiet?: boolean } = {}) => {
    if (!state?.token) return null;
    if (!opts.quiet) setBusy(true);
    try {
      const res = await callApi({ ...payload, token: state.token });
      // Algumas ações (ex.: shipping_options) retornam apenas dados auxiliares.
      // Não substituir o estado completo por essas respostas, pois isso apagava
      // o token da sessão e impedia o clique seguinte em uma forma de envio.
      if (res?.ok && res?.token) mergeState(res);
      return res;
    } catch (e: any) {
      if (!opts.quiet) toast.error(e.message || "Erro");
      return null;
    } finally {
      if (!opts.quiet) setBusy(false);
    }
  };


  // ---------- Confirmação (uma única vez por pedido) ----------
  const confirmOrder = async () => {
    const current = state?.order;
    const res = await act({ action: "confirm_order" });
    if (res?.ok) {
      if (current) markAnswered(current);
      hydrateForms(res);
      if (needsOnboarding(res)) {
        setOnboardStep(firstPendingOnboard(res));
        setStep("onboarding");
      } else {
        setStep("area");
      }
    }
  };

  const rejectAll = async () => {
    const current = state?.order;
    if (current) markAnswered(current);
    let res: any = null;
    for (let i = (current?.products?.length || 0) - 1; i >= 0; i--) {
      res = await act({ action: "reject_item", index: i });
    }
    if (res?.ok) hydrateForms(res);
    setStep("area");
    toast.success("Tudo bem! Os itens foram retirados do seu pedido.");
  };

  // ---------- Onboarding ----------
  const lookupCep = async (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    setAddr((a: any) => ({ ...a, cep: digits }));
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const j = await r.json();
      if (j?.erro) {
        toast.error("CEP não encontrado");
        return;
      }
      setAddr((a: any) => ({
        ...a,
        cep: digits,
        address: j.logradouro || a.address || "",
        neighborhood: j.bairro || "",
        city: j.localidade || "",
        state: j.uf || "",
      }));
    } catch {
      toast.error("Não foi possível buscar o CEP agora");
    } finally {
      setCepLoading(false);
    }
  };

  const loadShippingOptions = async (cep: string) => {
    setShipLoading(true);
    try {
      const res = await act({ action: "shipping_options", cep }, { quiet: true });
      setShipOptions(res?.options || []);
    } finally {
      setShipLoading(false);
    }
  };

  /**
   * As etapas avançam NA HORA e o salvamento acontece em segundo plano.
   * Se o servidor recusar, voltamos para a etapa anterior com o aviso.
   */
  const advance = async (
    next: OnboardStep | "area",
    back: OnboardStep,
    payload: Record<string, unknown>,
    errorMsg: string,
    onDone?: () => void,
  ) => {
    if (next === "area") setStep("area");
    else setOnboardStep(next);
    onDone?.();
    const res = await act(payload, { quiet: true });
    if (!res?.ok) {
      toast.error(
        res?.error === "otp_required"
          ? "Confirme o código do WhatsApp para alterar seus dados"
          : res?.error || errorMsg,
      );
      if (next === "area") setStep("onboarding");
      setOnboardStep(back);
    }
  };

  const saveAddressStep = () =>
    advance(
      "shipping",
      "address",
      {
        action: "save_details",
        details: {
          cep: addr.cep,
          address: addr.address,
          address_number: addr.address_number,
          complement: addr.complement,
          neighborhood: addr.neighborhood,
          city: addr.city,
          state: addr.state,
        },
      },
      "Erro ao salvar",
      () => loadShippingOptions(addr.cep),
    );

  /** Pula etapas cujos dados já estão salvos no cadastro da cliente. */
  const nextAfter = (current: OnboardStep): OnboardStep | "area" => {
    const ob: any = state?.onboarding || {};
    const order: OnboardStep[] = ["address", "shipping", "cpf", "email"];
    for (const s of order.slice(order.indexOf(current) + 1)) {
      if (!ob[s]) return s;
    }
    return "area";
  };

  const chooseShipping = (methodId: string) =>
    advance(
      nextAfter("shipping"),
      "shipping",
      { action: "set_shipping", method: methodId, cep: addr.cep },
      "Não foi possível escolher o envio",
    );

  const saveCpfStep = () =>
    advance(nextAfter("cpf"), "cpf", { action: "save_details", details: { cpf } }, "Erro ao salvar");

  const saveEmailStep = () =>
    advance("area", "email", { action: "save_details", details: { email } }, "Erro ao salvar", () =>
      toast.success("Tudo pronto! Agora é só pagar 🎉"),
    );


  const goCheckout = (method: "pix" | "card" | "debit") => {
    if (!state?.order) return;
    window.location.href = `${state.order.checkout_url}?method=${method}`;
  };

  // ── Pagamento nativo na Área de Membros ───────────────────────────────
  // Reaproveita EXATAMENTE a etapa 3 do checkout transparente. Os dados
  // enviados ao gateway são os mesmos salvos no cadastro do pedido
  // (customer_registrations), então o link do checkout segue sincronizado.
  const [installmentConfig, setInstallmentConfig] = useState<InstallmentConfig>({
    max_installments: 12,
    interest_free_installments: 6,
    monthly_interest_rate: 2.49,
  });

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "installment_config")
      .maybeSingle()
      .then(({ data }) => {
        const cfg = data?.value as any;
        if (cfg) {
          setInstallmentConfig({
            max_installments: cfg.max_installments || 12,
            interest_free_installments: cfg.interest_free_installments || 6,
            monthly_interest_rate: cfg.monthly_interest_rate || 2.49,
          });
        }
      });
  }, []);

  /** Dados completos do cliente para o gateway (null = precisa liberar/preencher). */
  const payForm: CustomerFormData | null = (() => {
    // Usa os dados completos (payDetails) — o mascaramento por OTP vale só
    // para exibição/edição, não deve bloquear o pagamento.
    const d = state?.payDetails || state?.details || {};
    if (d.masked) return null;
    const fullName = (d.full_name || state?.name || "").trim();
    const f: CustomerFormData = {
      fullName,
      email: (d.email || email || "").trim(),
      cpf: (d.cpf || cpf || "").replace(/\D/g, ""),
      whatsapp: state?.phone || "",
      cep: (d.cep || addr.cep || "").replace(/\D/g, ""),
      address: d.address || addr.address || "",
      addressNumber: d.address_number || addr.address_number || "",
      complement: d.complement || addr.complement || "",
      neighborhood: d.neighborhood || addr.neighborhood || "",
      city: d.city || addr.city || "",
      state: d.state || addr.state || "",
    };
    const ok = f.fullName && f.email && f.cpf.length === 11 && f.cep.length === 8 && f.address && f.city && f.state;
    return ok ? f : null;
  })();

  /** Após aprovação, atualiza o estado — o pedido já foi marcado como pago pelo gateway/webhook. */
  const handlePaymentConfirmed = async () => {
    toast.success("Pagamento confirmado! 🎉");
    const token = state?.token;
    if (!token) return;
    for (let i = 0; i < 5; i++) {
      const res = await callApi({ action: "state", token }).catch(() => null);
      if (res?.ok) {
        setState(res);
        if (res.order?.is_paid) break;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  };



  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-3">
        <h1 className="text-xl font-bold">Área indisponível</h1>
        <p className="text-muted-foreground text-sm">
          Este link não está ativo no momento. Volte para a live e tente novamente.
        </p>
      </div>
    );
  }

  const Header = (
    <div className="text-center space-y-3 pt-8 pb-6">
      <img
        src="/images/banana-logo.png"
        alt="Banana Calçados"
        className="w-16 h-16 rounded-full mx-auto object-cover"
      />
      {event?.is_live && (
        <div className="inline-flex items-center gap-1.5 bg-destructive/15 text-destructive text-xs font-bold px-3 py-1 rounded-full">
          <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          AO VIVO
        </div>
      )}
      <h1 className="text-xl font-bold px-6">MINHA ÁREA</h1>
    </div>
  );

  // ---------- Etapa 1: WhatsApp ----------
  if (step === "phone") {
    return (
      <div className="min-h-screen bg-muted/40 text-foreground flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm bg-card rounded-2xl shadow-lg border border-border p-8">
          <div className="flex flex-col items-center text-center">
            <ShoppingBag className="h-9 w-9 text-primary" strokeWidth={2.2} />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">ÁREA DE MEMBROS</h1>
            <p className="mt-2 text-muted-foreground text-base leading-snug">
              Digite seu WhatsApp pra continuar
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              enter();
            }}
            className="mt-8 space-y-6"
          >
            <div className="space-y-2 text-left">
              <Label className="text-sm text-muted-foreground">Whatsapp</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(33) 99999-9999"
                inputMode="tel"
                className="h-14 text-[18px] rounded-xl"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              disabled={phone.replace(/\D/g, "").length < 10 || busy}
              className="w-full h-14 text-base font-semibold rounded-xl gap-2"
            >
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              Continuar
            </Button>
          </form>

          <button
            type="button"
            onClick={backToLive}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar pra live
          </button>
        </div>
      </div>
    );
  }


  // ---------- Etapa 2: Nome ----------
  if (step === "name") {
    return (
      <div className="min-h-screen bg-background text-foreground px-6">
        <div className="max-w-sm mx-auto">
          <button
            onClick={() => setStep("phone")}
            className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          {Header}
          <p className="text-muted-foreground text-center text-sm mb-6">Como é o seu nome completo?</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enter(name.trim());
            }}
            className="space-y-4"
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maria Silva"
              className="h-16 text-[18px]"
              autoFocus
            />
            <Button
              type="submit"
              disabled={name.trim().length < 3 || busy}
              className="w-full h-16 text-base font-bold"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "CONTINUAR"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ---------- Etapa 2b: Confirmar WhatsApp (só cadastro novo sem pedidos) ----------
  if (step === "signup_otp") {
    return (
      <div className="min-h-screen bg-background text-foreground px-6">
        <div className="max-w-sm mx-auto pb-[40vh]">
          <button
            onClick={() => setStep("phone")}
            className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          {Header}
          <p className="text-muted-foreground text-center text-sm mb-6">
            Confirme seu WhatsApp para criar seu cadastro. Enviamos um código para {phone}.
          </p>
          <div className="space-y-4">
            <Button
              variant="outline"
              className="w-full h-14 font-semibold"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await callApi({ action: "send_otp", phone });
                  if (res?.ok) toast.success("Código enviado no seu WhatsApp");
                  else toast.error(res?.error || "Falha ao enviar código");
                } finally {
                  setBusy(false);
                }
              }}
            >
              RECEBER CÓDIGO NO WHATSAPP
            </Button>
            <Input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onFocus={(e) =>
                setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250)
              }
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="h-16 text-center text-2xl font-bold tracking-[0.4em]"
            />
            <Button
              className="w-full h-16 text-base font-bold"
              disabled={otp.length < 4 || busy}
              onClick={() => enter(undefined, otp)}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "CONFIRMAR E ENTRAR"}
            </Button>
          </div>
        </div>
      </div>
    );
  }



  const BackToLiveLink = (
    <button
      type="button"
      onClick={backToLive}
      className="mt-6 w-full inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Voltar pra live
    </button>
  );

  // ---------- Etapa 3: Confirmação do produto (uma vez por pedido) ----------
  if (step === "confirm" && state?.order?.products?.length) {
    const o = state.order;
    return (
      <div className="min-h-screen bg-muted/40 text-foreground flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm bg-card rounded-2xl shadow-lg border border-border p-6">
          <div className="space-y-2">
            {o.products.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-3 rounded-xl bg-primary/10 p-3">
                <div className="h-14 w-14 rounded-xl bg-card flex items-center justify-center overflow-hidden shrink-0">
                  {p.image ? (
                    <img src={p.image} alt={p.title} className="h-full w-full object-cover" />
                  ) : (
                    <ShoppingBag className="h-6 w-6 text-primary" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-primary leading-tight">{p.title}</p>
                  <p className="text-sm text-primary/80 flex flex-wrap items-center gap-1.5">
                    {p.variant ? <span>{p.variant} ·</span> : null}
                    {p.has_discount && (
                      <span className="line-through opacity-60">
                        {brl(Number(p.full_price ?? p.price ?? 0))}
                      </span>
                    )}
                    <span className="font-bold">
                      {brl(Number(p.effective_price ?? p.price ?? 0))}
                    </span>
                  </p>
                </div>

              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-lg font-bold leading-snug">
            {o.products.length > 1 ? "Estes produtos são seus" : "Este produto é seu"}
          </p>
          <p className="mt-1 text-center text-muted-foreground leading-snug">
            Só confirme se for realmente ficar com o produto
          </p>

          <div className="mt-6 space-y-3">
            <Button
              className="w-full h-14 text-base font-bold rounded-xl"
              disabled={busy}
              onClick={confirmOrder}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sim, confirmar"}
            </Button>
            <Button
              variant="outline"
              className="w-full h-14 text-base font-semibold rounded-xl"
              disabled={busy}
              onClick={rejectAll}
            >
              Não quero mais
            </Button>
          </div>

          {BackToLiveLink}
        </div>
      </div>
    );
  }

  // ---------- Etapa 4: Dados de envio por etapas ----------
  if (step === "onboarding") {
    const stepsOrder: OnboardStep[] = ["address", "shipping", "cpf", "email"];
    const idx = stepsOrder.indexOf(onboardStep);
    const titles: Record<OnboardStep, string> = {
      address: "Falta pouco pra confirmar",
      shipping: "Como você quer receber?",
      cpf: "Seu CPF",
      email: "Seu e-mail",
    };

    return (
      <div className="min-h-screen bg-muted/40 text-foreground flex items-start sm:items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm bg-card rounded-2xl shadow-lg border border-border p-6">
          <div className="flex gap-1.5">
            {stepsOrder.map((s, i) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{idx} de 4 etapas concluídas</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight">{titles[onboardStep]}</h2>

          {onboardStep === "address" && (
            <div className="mt-5 space-y-3">
              <Label className="text-sm text-muted-foreground">Endereço de entrega</Label>
              <div className="relative">
                <Input
                  value={addr.cep || ""}
                  onChange={(e) => lookupCep(e.target.value)}
                  placeholder="Buscar por CEP"
                  inputMode="numeric"
                  className="h-14 text-[16px] rounded-xl"
                  autoFocus
                />
                {cepLoading && (
                  <Loader2 className="h-5 w-5 animate-spin absolute right-4 top-4 text-muted-foreground" />
                )}
              </div>
              {!!addr.city && (
                <>
                  <Input
                    value={addr.address || ""}
                    onChange={(e) => setAddr((a: any) => ({ ...a, address: e.target.value }))}
                    placeholder="Rua"
                    className="h-14 text-[16px] rounded-xl"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      value={addr.address_number || ""}
                      onChange={(e) =>
                        setAddr((a: any) => ({ ...a, address_number: e.target.value }))
                      }
                      placeholder="Número"
                      className="h-14 text-[16px] rounded-xl"
                    />
                    <Input
                      value={addr.complement || ""}
                      onChange={(e) => setAddr((a: any) => ({ ...a, complement: e.target.value }))}
                      placeholder="Complemento"
                      className="h-14 text-[16px] rounded-xl"
                    />
                  </div>
                  <Input
                    value={addr.neighborhood || ""}
                    onChange={(e) => setAddr((a: any) => ({ ...a, neighborhood: e.target.value }))}
                    placeholder="Bairro"
                    className="h-14 text-[16px] rounded-xl"
                  />
                  <p className="text-sm text-muted-foreground">
                    {addr.city}/{addr.state}
                  </p>
                </>
              )}
              <Button
                className="w-full h-14 text-base font-semibold rounded-xl mt-2"
                disabled={
                  busy ||
                  String(addr.cep || "").replace(/\D/g, "").length !== 8 ||
                  !addr.address ||
                  !addr.address_number
                }
                onClick={saveAddressStep}
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continuar"}
              </Button>
            </div>
          )}

          {onboardStep === "shipping" && (
            <div className="mt-5 space-y-3">
              {shipLoading ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                shipOptions.map((opt) => (
                  <button
                    key={opt.id}
                    disabled={busy}
                    onClick={() => chooseShipping(opt.id)}
                    className="w-full text-left rounded-xl border-2 border-border hover:border-primary p-4 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{opt.label}</span>
                      <span className="font-bold text-primary">
                        {opt.cost > 0 ? brl(opt.cost) : "Grátis"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
                    {opt.id === "delivery" && opt.delivery_days ? (
                      <p className="text-xs font-medium text-foreground mt-1">
                        Chega em até {opt.delivery_days}{" "}
                        {opt.delivery_days > 1 ? "dias úteis" : "dia útil"} após a postagem
                      </p>
                    ) : null}


                  </button>
                ))
              )}
              <button
                onClick={() => setOnboardStep("address")}
                className="text-sm text-muted-foreground underline"
              >
                Alterar endereço
              </button>
            </div>
          )}

          {onboardStep === "cpf" && (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-muted-foreground">Usamos só para emitir sua nota fiscal.</p>
              <Input
                value={cpf}
                onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="000.000.000-00"
                inputMode="numeric"
                className="h-14 text-[16px] rounded-xl"
                autoFocus
              />
              <Button
                className="w-full h-14 text-base font-semibold rounded-xl"
                disabled={busy || cpf.replace(/\D/g, "").length !== 11}
                onClick={saveCpfStep}
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continuar"}
              </Button>
              <button
                onClick={() => setOnboardStep("shipping")}
                className="text-sm text-muted-foreground underline"
              >
                Voltar
              </button>
            </div>
          )}

          {onboardStep === "email" && (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-muted-foreground">
                Enviamos a nota fiscal e o código de rastreio neste e-mail.
              </p>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                inputMode="email"
                className="h-14 text-[16px] rounded-xl"
                autoFocus
              />
              <Button
                className="w-full h-14 text-base font-semibold rounded-xl"
                disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}
                onClick={saveEmailStep}
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Concluir"}
              </Button>
              <button
                onClick={() => setOnboardStep("cpf")}
                className="text-sm text-muted-foreground underline"
              >
                Voltar
              </button>
            </div>
          )}

          {BackToLiveLink}
        </div>
      </div>
    );
  }



  // ---------- Área do cliente ----------
  const order = state?.order;
  const mm = remaining != null ? String(Math.floor(remaining / 60)).padStart(2, "0") : null;
  const ss = remaining != null ? String(remaining % 60).padStart(2, "0") : null;

  return (
    <div className="min-h-screen bg-background text-foreground pb-28">
      <div className="max-w-md mx-auto px-5">
        {Header}
        <p className="text-center text-lg font-semibold -mt-3 mb-4">Oi, {state?.name} 👋</p>

        <div className="flex gap-2 mb-6">
          <Button variant="outline" className="flex-1 h-11 gap-2 text-xs font-semibold" onClick={backToLive}>
            <ArrowLeft className="h-4 w-4" /> VOLTAR PRA LIVE
          </Button>
          <Button variant="ghost" className="flex-1 h-11 gap-2 text-xs font-semibold text-muted-foreground" onClick={logout}>
            <LogOut className="h-4 w-4" /> SAIR DA ÁREA
          </Button>
        </div>



        {/* Roleta de prêmios */}
        {availableWheels.length > 0 && (
          <div className="mb-6 space-y-2">
            {availableWheels.map((w) => (
              <button
                key={w.id}
                onClick={() => setActiveWheel(w)}
                className="w-full rounded-2xl px-5 py-4 font-black text-white text-base bg-gradient-to-r from-yellow-400 via-orange-500 to-pink-500 shadow-lg shadow-orange-500/40 animate-pulse hover:scale-[1.02] transition-transform"
              >
                🎰 ROLETA DE PRÊMIOS — {w.name}
              </button>
            ))}
          </div>
        )}

        {activeWheel && (
          <EventPrizeWheelDialog
            wheel={activeWheel}
            phone={state?.phone || phone.replace(/\D/g, "")}
            name={state?.name}
            onClose={() => setActiveWheel(null)}
            onDone={refreshWheels}
          />
        )}


        {/* Meu pedido */}
        <section className="rounded-2xl border-2 border-border p-4 space-y-3">
          <h2 className="font-bold text-base flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" /> Meu pedido
            <span className="ml-auto flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
              {syncing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> atualizando
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> ao vivo
                </>
              )}
            </span>
          </h2>

          {!order || order.products.length === 0 ? (
            <div className="py-6 text-center space-y-3">
              <p className="text-muted-foreground text-sm">
                Você ainda não tem nenhum produto reservado.
              </p>
              <p className="text-muted-foreground text-xs">
                Comente na live o produto e o tamanho que você quer — assim que a gente anotar, aparece
                aqui automaticamente.
              </p>
            </div>
          ) : (
            <>
              {order.products.map((p: any, i: number) => (
                <div key={i} className="flex gap-3 items-center border-b border-border/60 pb-3 last:border-0">
                  {p.image && (
                    <img src={p.image} alt={p.title} className="w-16 h-16 rounded-lg object-cover" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">{p.variant}</p>
                    <p className="text-sm font-bold flex items-center gap-1.5">
                      {p.has_discount && (
                        <span className="text-xs font-normal line-through text-muted-foreground">
                          {brl(Number(p.full_price ?? p.price ?? 0))}
                        </span>
                      )}
                      {brl(Number(p.effective_price ?? p.price ?? 0))}
                    </p>
                  </div>
                  {!order.is_paid && (
                    <button
                      onClick={() => act({ action: "reject_item", index: i })}
                      disabled={busy}
                      aria-label="Remover item"
                      className="p-3 rounded-lg text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  )}
                </div>
              ))}
              <div className="pt-1 space-y-1">
                {typeof order.subtotal === "number" && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Produtos</span>
                    <span>{brl(order.subtotal)}</span>
                  </div>
                )}
                {!!order.discount && (
                  <div className="flex justify-between text-sm text-primary font-medium">
                    <span>Desconto</span>
                    <span>-{brl(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Frete</span>
                  <span>
                    {order.shipping_pending
                      ? "Calculado no envio"
                      : order.free_shipping || !order.shipping_cost
                        ? "Grátis"
                        : brl(order.shipping_cost)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-xl font-bold">{brl(order.total)}</span>
                </div>
                {!order.is_paid && !!order.pix_discount_percent && (
                  <div className="flex justify-between items-center rounded-xl bg-primary/10 px-3 py-2 mt-1">
                    <span className="text-xs font-semibold text-primary">
                      No PIX ({order.pix_discount_percent}% OFF)
                    </span>
                    <span className="text-lg font-extrabold text-primary">
                      {brl(order.pix_total ?? order.total)}
                    </span>
                  </div>
                )}
              </div>


              {order.is_paid ? (
                <div className="flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-primary font-semibold text-sm">
                  <CheckCircle2 className="h-5 w-5" /> Pagamento confirmado!
                </div>
              ) : order.confirmed_at ? (
                <div className="space-y-3">
                  {mm && (
                    <div className="flex items-center justify-center gap-2 rounded-xl bg-destructive/10 text-destructive font-bold py-3">
                      <Timer className="h-5 w-5" /> Pague em {mm}:{ss}
                    </div>
                  )}
                  {!state?.onboardingComplete ? (
                    <Button
                      className="w-full h-16 text-base font-bold"
                      onClick={() => {
                        setOnboardStep(firstPendingOnboard(state));
                        setStep("onboarding");
                      }}
                    >
                      COMPLETAR MEUS DADOS DE ENVIO
                    </Button>
                  ) : payForm ? (
                    <div className="rounded-2xl border-2 border-border p-3">
                      <StepPayment
                        orderId={order.id}
                        amount={order.total}
                        products={(order.products || []).map((p: any) => ({
                          title: p.title,
                          variant: p.variant,
                          price: Number(p.effective_price ?? p.price ?? 0),
                          quantity: Number(p.quantity || 1),
                          image: p.image,
                        }))}
                        form={payForm}
                        installmentConfig={installmentConfig}
                        stepBadge={null}
                        onPaymentConfirmed={handlePaymentConfirmed}
                      />
                      <button
                        type="button"
                        onClick={() => goCheckout("pix")}
                        className="w-full mt-3 text-xs text-muted-foreground underline"
                      >
                        Prefiro pagar pelo link do checkout
                      </button>
                    </div>
                  ) : (
                    <Button
                      className="w-full h-16 text-base font-bold"
                      onClick={() => {
                        setOnboardStep(firstPendingOnboard(state));
                        setStep("onboarding");
                      }}
                    >
                      COMPLETAR MEUS DADOS PARA PAGAR
                    </Button>
                  )}
                </div>
              ) : (
                <Button className="w-full h-16 text-base font-bold" onClick={() => setStep("confirm")}>
                  CONFIRMAR MEU PEDIDO
                </Button>
              )}

            </>
          )}
        </section>

        {/* Histórico de compras (todas as lives) */}
        {Array.isArray(state?.history) && state!.history.length > 0 && (
          <section className="rounded-2xl border-2 border-border p-4 mt-5 space-y-3">
            <h2 className="font-bold text-base flex items-center gap-2">
              <History className="h-5 w-5 text-primary" /> Meus pedidos anteriores
            </h2>
            {state!.history.map((h) => (
              <div key={h.id} className="rounded-xl bg-muted/40 p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground truncate">
                    {h.event_name || "Pedido"} ·{" "}
                    {new Date(h.created_at).toLocaleDateString("pt-BR")}
                  </p>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      h.is_paid ? "bg-primary/15 text-primary" : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {h.is_paid ? "PAGO" : "EM ABERTO"}
                  </span>
                </div>
                {h.items.map((it, i) => (
                  <p key={i} className="text-sm">
                    {it.quantity}x {it.title}
                    {it.variant ? ` — ${it.variant}` : ""}
                  </p>
                ))}
                <p className="text-sm font-bold">{brl(h.total)}</p>
              </div>
            ))}
          </section>
        )}

        {/* Meus dados */}
        <section className="rounded-2xl border-2 border-border p-4 mt-5 space-y-3">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" /> Meus dados
          </h2>
          <p className="text-sm">
            <span className="text-muted-foreground">Nome: </span>
            {state?.name}
          </p>
          {state?.hasDetails && !state?.otpUnlocked ? (
            <>
              <p className="text-sm text-muted-foreground">CPF: {state.details?.cpf || "—"}</p>
              <p className="text-sm text-muted-foreground">E-mail: {state.details?.email || "—"}</p>
              <p className="text-sm text-muted-foreground">Endereço: {state.details?.address || "—"}</p>
              <Button
                variant="outline"
                className="w-full h-14 border-2 border-primary bg-primary/10 font-bold"
                onClick={async () => {
                  const res = await act({ action: "send_otp" });
                  if (res?.ok) {
                    setOtpOpen(true);
                    toast.success("Código enviado no seu WhatsApp");
                  } else toast.error(res?.error || "Falha ao enviar código");
                }}
                disabled={busy}
              >
                VER / EDITAR MEUS DADOS
              </Button>
            </>
          ) : (
            <>
              {state?.hasDetails && (
                <div className="text-sm space-y-1">
                  <p>CPF: {state.details?.cpf || "—"}</p>
                  <p>E-mail: {state.details?.email || "—"}</p>
                  <p>
                    Endereço: {state.details?.address || "—"}, {state.details?.address_number || ""} —{" "}
                    {state.details?.city || ""}/{state.details?.state || ""}
                  </p>
                </div>
              )}
              <Button
                variant="outline"
                className="w-full h-14 border-2 border-primary bg-primary/10 font-bold"
                onClick={() => {
                  setForm({ full_name: state?.name || "", ...(state?.details || {}) });
                  setDetailsOpen(true);
                }}
              >
                {state?.hasDetails ? "EDITAR MEUS DADOS" : "PREENCHER MEUS DADOS"}
              </Button>
            </>
          )}
        </section>

        <a
          href="https://wa.me/5533999999999"
          className="mt-5 flex items-center justify-center gap-2 h-14 rounded-2xl border-2 border-border font-semibold"
        >
          <MessageCircle className="h-5 w-5" /> Falar com uma vendedora
        </a>
      </div>




      {/* Modal: OTP */}
      {otpOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto flex items-start justify-center p-4">
          <div className="bg-background w-full sm:max-w-md rounded-3xl p-6 space-y-4 mt-6 mb-[60vh]">
            <h3 className="text-lg font-bold text-center">Digite o código do WhatsApp</h3>
            <Input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onFocus={(e) =>
                setTimeout(
                  () => e.target.scrollIntoView({ block: "center", behavior: "smooth" }),
                  250,
                )
              }
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="h-16 text-center text-2xl font-bold tracking-[0.4em]"
              autoFocus
            />
            <Button
              className="w-full h-16 text-base font-bold"
              disabled={otp.length < 4 || busy}

              onClick={async () => {
                const res = await act({ action: "verify_otp", code: otp });
                if (res?.ok) {
                  setOtpOpen(false);
                  setOtp("");
                  toast.success("Dados liberados por 30 minutos");
                } else toast.error(res?.error || "Código inválido");
              }}
            >
              LIBERAR MEUS DADOS
            </Button>
            <Button variant="ghost" className="w-full h-12" onClick={() => setOtpOpen(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      {/* Modal: dados pessoais */}
      {detailsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto">
          <div className="bg-background min-h-screen sm:min-h-0 sm:max-w-md sm:mx-auto sm:mt-10 sm:rounded-3xl p-6 space-y-3">
            <button
              onClick={() => setDetailsOpen(false)}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
            <h3 className="text-lg font-bold">Meus dados</h3>
            {[
              ["full_name", "Nome completo"],
              ["cpf", "CPF"],
              ["email", "E-mail"],
              ["cep", "CEP"],
              ["address", "Endereço"],
              ["address_number", "Número"],
              ["complement", "Complemento"],
              ["neighborhood", "Bairro"],
              ["city", "Cidade"],
              ["state", "UF"],
            ].map(([k, label]) => (
              <div key={k} className="space-y-1">
                <Label className="text-sm">{label}</Label>
                <Input
                  value={form[k] ?? ""}
                  onChange={(e) => setForm((f: any) => ({ ...f, [k]: e.target.value }))}
                  className="h-14 text-[16px]"
                />
              </div>
            ))}
            <Button
              className="w-full h-16 text-base font-bold"
              disabled={busy}
              onClick={async () => {
                const res = await act({ action: "save_details", details: form });
                if (res?.ok) {
                  setDetailsOpen(false);
                  toast.success("Dados salvos!");
                } else if (res?.error === "otp_required") {
                  toast.error("Confirme o código do WhatsApp para editar seus dados");
                } else toast.error(res?.error || "Erro ao salvar");
              }}
            >
              SALVAR
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
