import { useNavigate } from "react-router-dom";
import { 
  LayoutDashboard, 
  Calendar, 
  MessageSquare, 
  Megaphone, 
  Truck, 
  LogOut,
  Instagram
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
    color: "bg-primary/10 text-primary",
  },
  {
    title: "Eventos",
    description: "Gerencie suas lives e eventos",
    icon: Calendar,
    path: "/events",
    color: "bg-accent/10 text-accent",
  },
  {
    title: "Chat",
    description: "Conversas do WhatsApp",
    icon: MessageSquare,
    path: "/chat",
    color: "bg-stage-contacted/10 text-stage-contacted",
  },
  {
    title: "Marketing",
    description: "Campanhas e listas de contatos",
    icon: Megaphone,
    path: "/marketing",
    color: "bg-stage-awaiting/10 text-stage-awaiting",
  },
  {
    title: "Expedição",
    description: "Picking, packing e despacho",
    icon: Truck,
    path: "/expedition",
    color: "bg-stage-paid/10 text-stage-paid",
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
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Instagram className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Live CRM</h1>
              <p className="text-xs text-muted-foreground">Painel de Controle</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container py-10">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground">Bem-vindo ao Live CRM</h2>
          <p className="text-muted-foreground mt-1">Selecione um módulo para começar</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((mod) => (
            <Card
              key={mod.path}
              className="cursor-pointer hover:shadow-lg hover:border-primary/30 transition-all group"
              onClick={() => navigate(mod.path)}
            >
              <CardContent className="flex items-center gap-4 p-6">
                <div className={`p-3 rounded-xl ${mod.color} transition-transform group-hover:scale-110`}>
                  <mod.icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{mod.title}</h3>
                  <p className="text-sm text-muted-foreground">{mod.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
