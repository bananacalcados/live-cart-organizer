import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CentralRestockPanel } from "@/components/admin/CentralRestockPanel";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/** Página própria de "produtos oferecidos sem estoque" das Centrais; a gravação também é conferida no servidor (somente admin). */
export default function CentralRestock() {
  const { isAdmin, ready } = useIsAdmin();
  return (
    <div className="min-h-screen bg-background">
      <main className="container py-6 space-y-4">
        <Link to="/admin?tab=central-restock"><Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" />Administração</Button></Link>
        {!ready ? <p className="text-sm text-muted-foreground">Carregando…</p>
          : isAdmin ? <CentralRestockPanel />
          : <p className="text-sm text-muted-foreground">Somente administradores podem alterar os produtos oferecidos nas trocas.</p>}
      </main>
    </div>
  );
}
