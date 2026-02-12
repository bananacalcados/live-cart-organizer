import { useNavigate } from "react-router-dom";
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
  Banana
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const modules = [
  {
    title: "Dashboard",
    description: "Kanban de pedidos, promoções e roleta",
    icon: LayoutDashboard,
    path: "/dashboard",
  },
  {
    title: "Eventos",
    description: "Gerencie suas lives e eventos",
    icon: Calendar,
    path: "/events",
  },
  {
    title: "Chat",
    description: "Conversas do WhatsApp",
    icon: MessageSquare,
    path: "/chat",
  },
  {
    title: "Marketing",
    description: "Campanhas e listas de contatos",
    icon: Megaphone,
    path: "/marketing",
  },
  {
    title: "Expedição",
    description: "Picking, packing e despacho",
    icon: Truck,
    path: "/expedition",
  },
  {
    title: "Frente de Caixa",
    description: "PDV para vendas em loja física",
    icon: Store,
    path: "/pos",
  },
  {
    title: "Estoque",
    description: "Balanço e correção de estoque",
    icon: Package,
    path: "/inventory",
  },
  {
    title: "Gestão",
    description: "Vendas, custos, margens e estoque consolidado",
    icon: BarChart3,
    path: "/management",
  },
];

export default function Home() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: "Logout realizado" });
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'hsl(0 0% 6%)' }}>
      <header className="sticky top-0 z-50 w-full border-b border-white/10" style={{ background: 'hsl(0 0% 4%)' }}>
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'hsl(48 95% 50%)' }}>
              <Banana className="h-5 w-5" style={{ color: 'hsl(0 0% 5%)' }} />
            </div>
            <div>
              <h1 className="text-lg font-bold" style={{ color: 'hsl(48 95% 50%)' }}>GESTOR BANANA</h1>
              <p className="text-xs" style={{ color: 'hsl(0 0% 55%)' }}>Painel de Controle</p>
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
          <h2 className="text-2xl font-bold" style={{ color: 'hsl(0 0% 95%)' }}>Bem-vindo ao GESTOR BANANA</h2>
          <p className="mt-1" style={{ color: 'hsl(0 0% 55%)' }}>Selecione um módulo para começar</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((mod) => (
            <Card
              key={mod.path}
              className="cursor-pointer transition-all group border-white/10 hover:border-[hsl(48,95%,50%)]/40"
              style={{ background: 'hsl(0 0% 10%)' }}
              onClick={() => navigate(mod.path)}
            >
              <CardContent className="flex items-center gap-4 p-6">
                <div 
                  className="p-3 rounded-xl transition-transform group-hover:scale-110"
                  style={{ background: 'hsla(48, 95%, 50%, 0.15)', color: 'hsl(48 95% 50%)' }}
                >
                  <mod.icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold" style={{ color: 'hsl(0 0% 95%)' }}>{mod.title}</h3>
                  <p className="text-sm" style={{ color: 'hsl(0 0% 55%)' }}>{mod.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
