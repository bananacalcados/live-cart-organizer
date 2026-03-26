import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Calendar,
  MessageSquare,
  Megaphone,
  Truck,
  LogOut,
  Store,
  Package,
  BarChart3,
  Banana,
  Shield,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuthReady } from "@/hooks/useAuthReady";

const modules = [
  {
    title: "Dashboard",
    description: "Kanban de pedidos, promoções e roleta",
    icon: LayoutDashboard,
    path: "/dashboard",
    module: "dashboard",
  },
  {
    title: "Eventos",
    description: "Gerencie suas lives e eventos",
    icon: Calendar,
    path: "/events",
    module: "events",
  },
  {
    title: "Chat",
    description: "Conversas do WhatsApp",
    icon: MessageSquare,
    path: "/chat",
    module: "chat",
  },
  {
    title: "Marketing",
    description: "Campanhas e listas de contatos",
    icon: Megaphone,
    path: "/marketing",
    module: "marketing",
  },
  {
    title: "Expedição Beta",
    description: "Auto-sync Shopify + código de barras",
    icon: Truck,
    path: "/expedition-beta",
    module: "expedition",
  },
  {
    title: "Frente de Caixa",
    description: "PDV para vendas em loja física",
    icon: Store,
    path: "/pos",
    module: "pos",
  },
  {
    title: "Estoque",
    description: "Balanço e correção de estoque",
    icon: Package,
    path: "/inventory",
    module: "inventory",
  },
  {
    title: "Gestão",
    description: "Vendas, custos, margens e estoque consolidado",
    icon: BarChart3,
    path: "/management",
    module: "management",
  },
  {
    title: "Administração",
    description: "Usuários e permissões de acesso",
    icon: Shield,
    path: "/admin",
    module: "admin",
  },
];

export default function Home() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, isReady } = useAuthReady();
  const [allowedModules, setAllowedModules] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isReady) return;

    let cancelled = false;

    const timeoutPromise = <T,>(ms: number, fallback: T) =>
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms));

    const loadAllowedModules = async (userId: string, attempt = 1): Promise<string[]> => {
      const result = await Promise.race([
        supabase.rpc("get_user_allowed_modules", { p_user_id: userId }),
        timeoutPromise(8000, { data: null, error: new Error("timeout") }),
      ]);

      if (result.error || !result.data) {
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          return loadAllowedModules(userId, attempt + 1);
        }
        throw result.error || new Error("Falha ao carregar permissões");
      }

      return result.data as string[];
    };

    const checkPermissions = async () => {
      try {
        if (!session) {
          if (!cancelled) {
            setAllowedModules([]);
            navigate("/login", { replace: true });
          }
          return;
        }

        const modules = await loadAllowedModules(session.user.id);
        if (!cancelled) setAllowedModules(modules);
      } catch (err) {
        console.error("Error checking permissions:", err);
        if (!cancelled) {
          setAllowedModules([]);
          toast({
            title: "Erro ao verificar permissões",
            description: "Não foi possível conectar ao servidor. Tente recarregar a página.",
            variant: "destructive",
          });
        }
      }
    };

    checkPermissions();

    return () => {
      cancelled = true;
    };
  }, [isReady, session, navigate, toast]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: "Logout realizado" });
    navigate("/login");
  };

  const visibleModules = allowedModules ? modules.filter((m) => allowedModules.includes(m.module)) : [];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "hsl(0 0% 6%)" }}>
      <header className="sticky top-0 z-50 w-full border-b border-white/10" style={{ background: "hsl(0 0% 4%)" }}>
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "hsl(48 95% 50%)" }}>
              <Banana className="h-5 w-5" style={{ color: "hsl(0 0% 5%)" }} />
            </div>
            <div>
              <h1 className="text-lg font-bold" style={{ color: "hsl(48 95% 50%)" }}>GESTOR BANANA</h1>
              <p className="text-xs" style={{ color: "hsl(0 0% 55%)" }}>Painel de Controle</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Sair" className="text-white/60 hover:text-white hover:bg-white/10">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container py-10">
        <div className="mb-8">
          <h2 className="text-2xl font-bold" style={{ color: "hsl(0 0% 95%)" }}>Bem-vindo ao GESTOR BANANA</h2>
          <p className="mt-1" style={{ color: "hsl(0 0% 55%)" }}>Selecione um módulo para começar</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {allowedModules === null ? (
            <div className="col-span-full flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "hsl(48 95% 50%)" }} />
            </div>
          ) : visibleModules.map((mod) => (
            <Card
              key={mod.path}
              className="cursor-pointer transition-all group border-white/10 hover:border-[hsl(48,95%,50%)]/40"
              style={{ background: "hsl(0 0% 10%)" }}
              onClick={() => navigate(mod.path)}
            >
              <CardContent className="flex items-center gap-4 p-6">
                <div
                  className="p-3 rounded-xl transition-transform group-hover:scale-110"
                  style={{ background: "hsla(48, 95%, 50%, 0.15)", color: "hsl(48 95% 50%)" }}
                >
                  <mod.icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold" style={{ color: "hsl(0 0% 95%)" }}>{mod.title}</h3>
                  <p className="text-sm" style={{ color: "hsl(0 0% 55%)" }}>{mod.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}

