import { Banana, Plus, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TemplateManager } from "./TemplateManager";
import { ThemeToggle } from "./ThemeToggle";

interface HeaderProps {
  onNewOrder: () => void;
}

export function Header({ onNewOrder }: HeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Banana className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">GESTOR BANANA</h1>
            <p className="text-xs text-muted-foreground">Gerencie pedidos da sua Live</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-1">
            <Home className="h-4 w-4" />
            Início
          </Button>
          <ThemeToggle />
          <TemplateManager />
          <Button onClick={onNewOrder} className="btn-accent gap-2">
            <Plus className="h-4 w-4" />
            Novo Pedido
          </Button>
        </div>
      </div>
    </header>
  );
}
