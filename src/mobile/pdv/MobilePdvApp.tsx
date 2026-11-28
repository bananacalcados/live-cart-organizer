import { useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Check, DollarSign, Loader2, MessageSquare, Menu, Monitor, RotateCcw, ShoppingCart, Store, Truck, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { isExpeditionOnly } from "@/lib/pos/sectionAccess";
import { setPdvDesktopPreference } from "./redirect";
import { BOTTOM_TABS, MOBILE_PDV_TABS, MobilePdvTab, fullVersionUrl, visibleMobileTabs } from "./sections";

/** PDV no celular — Fase 0: só leitura (estrutura, loja, vendedora, "Em breve"). Nada grava. */
const STORE_KEY = "m_pdv_store";
const sellerKey = (store: string) => `m_pdv_seller:${store}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } };
const ICONS: Record<MobilePdvTab, typeof Truck> = { expedicao: Truck, whatsapp: MessageSquare, venda: ShoppingCart, caixa: DollarSign, dashboard: BarChart3, clientes: Users, trocas: RotateCcw };

function useAccess() {
  return useQuery({
    queryKey: ["m-pdv-modules"], staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return [] as string[];
      const { data: modules, error } = await supabase.rpc("get_user_allowed_modules", { p_user_id: data.user.id });
      return error ? ["expedition"] : ((modules || []) as string[]); // mesmo fallback do desktop
    },
  });
}
function useStores() {
  return useQuery({
    queryKey: ["m-pdv-stores"], staleTime: 10 * 60_000,
    queryFn: async () => ((await supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name")).data || []) as { id: string; name: string }[],
  });
}
function useSellers(store: string) {
  return useQuery({
    queryKey: ["m-pdv-sellers", store], enabled: !!store, staleTime: 5 * 60_000,
    queryFn: async () => ((await supabase.from("pos_sellers").select("id, name").eq("store_id", store).eq("is_active", true).order("name")).data || []) as { id: string; name: string }[],
  });
}

function Header({ title, store }: { title: string; store?: string }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background px-3">
      <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Voltar" onClick={() => navigate("/")}><ArrowLeft className="h-5 w-5" /></Button>
      <h1 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h1>
      {store && <span className="max-w-[40%] truncate text-xs text-muted-foreground">{store}</span>}
    </header>
  );
}

function OptionList({ items, selected, onPick }: { items: { id: string; name: string }[]; selected?: string | null; onPick: (id: string) => void }) {
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.id}>
          <button onClick={() => onPick(it.id)} className={cn("flex min-h-[56px] w-full items-center gap-3 rounded-lg border px-4 text-left text-base", selected === it.id && "border-primary bg-primary/10 font-semibold")}>
            <span className="min-w-0 flex-1 truncate">{it.name}</span>
            {selected === it.id && <Check className="h-5 w-5 text-primary" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

function StorePicker({ onPick, current }: { onPick: (id: string) => void; current?: string | null }) {
  const { data: stores, isLoading, isError } = useStores();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Escolha a loja</p>
      {isLoading && <Loader2 className="mx-auto h-6 w-6 animate-spin" />}
      {isError && <p role="alert" className="text-sm text-destructive">Não consegui carregar as lojas.</p>}
      {stores && <OptionList items={stores} selected={current} onPick={onPick} />}
    </div>
  );
}

function ComingSoon({ tab }: { tab: MobilePdvTab }) {
  const t = MOBILE_PDV_TABS.find((x) => x.id === tab)!;
  const Icon = ICONS[tab];
  return (
    <div className="space-y-4 rounded-xl border p-6 text-center">
      <Icon className="mx-auto h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-bold">{t.label}</h2>
      <p className="text-sm text-muted-foreground">Em breve no celular. Por enquanto, use a versão completa.</p>
      <FullVersionButton tab={tab} />
    </div>
  );
}

function FullVersionButton({ tab, variant = "default" }: { tab: MobilePdvTab; variant?: "default" | "outline" }) {
  return (
    <Button asChild variant={variant} className="h-12 w-full text-base">
      <Link to={fullVersionUrl(tab)} onClick={() => setPdvDesktopPreference(true)}><Monitor className="mr-2 h-5 w-5" /> Ver versão completa</Link>
    </Button>
  );
}

function MoreScreen({ tabs, storeName, sellerName, onChangeStore, onChangeSeller }: { tabs: MobilePdvTab[]; storeName: string; sellerName?: string; onChangeStore: () => void; onChangeSeller: () => void }) {
  const extra = tabs.filter((t) => !BOTTOM_TABS.includes(t));
  return (
    <div className="space-y-4">
      {extra.length > 0 && (
        <ul className="space-y-2">
          {extra.map((id) => { const Icon = ICONS[id]; const t = MOBILE_PDV_TABS.find((x) => x.id === id)!; return (
            <li key={id}><Link to={`/m/pdv/${id}`} className="flex min-h-[56px] items-center gap-3 rounded-lg border px-4 text-base"><Icon className="h-5 w-5" />{t.label}</Link></li>
          ); })}
        </ul>
      )}
      <button onClick={onChangeStore} className="flex min-h-[56px] w-full items-center gap-3 rounded-lg border px-4 text-left text-base"><Store className="h-5 w-5" /><span className="min-w-0 flex-1 truncate">Loja: {storeName}</span><span className="text-sm text-primary">Trocar</span></button>
      <button onClick={onChangeSeller} className="flex min-h-[56px] w-full items-center gap-3 rounded-lg border px-4 text-left text-base"><User className="h-5 w-5" /><span className="min-w-0 flex-1 truncate">Vendedora: {sellerName || "não escolhida"}</span><span className="text-sm text-primary">Trocar</span></button>
      <Button asChild variant="outline" className="h-12 w-full text-base">
        <Link to="/pos" onClick={() => setPdvDesktopPreference(true)}><Monitor className="mr-2 h-5 w-5" /> Ver versão completa</Link>
      </Button>
    </div>
  );
}

export default function MobilePdvApp() {
  const { data: modules } = useAccess();
  const { data: stores } = useStores();
  const [store, setStore] = useState<string | null>(() => read(STORE_KEY));
  const [seller, setSeller] = useState<string | null>(() => (store ? read(sellerKey(store)) : null));
  const [picking, setPicking] = useState<"store" | "seller" | null>(null);
  const { data: sellers } = useSellers(store || "");
  const storeName = stores?.find((s) => s.id === store)?.name;
  const validStore = !!store && !!stores && !!storeName;

  if (!modules || !stores) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  const expOnly = isExpeditionOnly(modules);
  const tabs = visibleMobileTabs(expOnly);
  const pickStore = (id: string) => { write(STORE_KEY, id); setStore(id); setSeller(read(sellerKey(id))); setPicking(null); };
  const pickSeller = (id: string) => { if (store) write(sellerKey(store), id); setSeller(id); setPicking(null); };

  if (!validStore || picking === "store") return (
    <div className="min-h-screen bg-background"><Header title="PDV" /><main className="mx-auto w-full max-w-md p-4"><StorePicker onPick={pickStore} current={store} /></main></div>
  );
  if (picking === "seller") return (
    <div className="min-h-screen bg-background"><Header title="Quem está usando?" store={storeName} />
      <main className="mx-auto w-full max-w-md space-y-3 p-4">
        {!sellers ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : sellers.length ? <OptionList items={sellers} selected={seller} onPick={pickSeller} /> : <p className="text-sm text-muted-foreground">Nenhuma vendedora ativa nesta loja.</p>}
      </main>
    </div>
  );

  const sellerName = sellers?.find((s) => s.id === seller)?.name;
  const bottom = expOnly ? (["expedicao"] as MobilePdvTab[]) : BOTTOM_TABS;
  const screen = (title: string, body: React.ReactNode) => (
    <div className="min-h-screen bg-background pb-24">
      <Header title={title} store={storeName} />
      <main className="mx-auto w-full max-w-md space-y-4 p-4">{body}</main>
    </div>
  );

  return (
    <>
      <Routes>
        <Route index element={<Navigate to={`/m/pdv/${tabs[0]}`} replace />} />
        {tabs.map((id) => <Route key={id} path={id} element={screen(MOBILE_PDV_TABS.find((t) => t.id === id)!.label, <ComingSoon tab={id} />)} />)}
        <Route path="mais" element={screen("Mais", <MoreScreen tabs={tabs} storeName={storeName!} sellerName={sellerName} onChangeStore={() => setPicking("store")} onChangeSeller={() => setPicking("seller")} />)} />
        <Route path="*" element={<Navigate to={`/m/pdv/${tabs[0]}`} replace />} />
      </Routes>
      <nav aria-label="Navegação do PDV" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-md">
          {[...bottom, "mais" as const].map((id) => {
            const Icon = id === "mais" ? Menu : ICONS[id];
            const label = id === "mais" ? "Mais" : MOBILE_PDV_TABS.find((t) => t.id === id)!.label;
            return (
              <li key={id} className="flex-1">
                <NavLink to={`/m/pdv/${id}`} className={({ isActive }) => cn("flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px]", isActive ? "font-bold text-primary" : "text-muted-foreground")}>
                  <Icon className="h-5 w-5" />{label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
