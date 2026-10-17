import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
export function AppLoadFailure() {
  return <main className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
    <div className="max-w-sm space-y-4 text-center">
      <h1 className="text-xl font-bold">Não foi possível abrir a página</h1>
      <p className="text-sm text-muted-foreground">Confira sua conexão e tente novamente.</p>
      <Button onClick={() => window.location.reload()} className="gap-2"><RefreshCw className="h-4 w-4" /> Tentar novamente</Button>
    </div>
  </main>;
}
