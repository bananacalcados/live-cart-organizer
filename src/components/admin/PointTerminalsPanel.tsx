import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Smartphone, RefreshCw, CheckCircle2, AlertTriangle, FlaskConical } from "lucide-react";

interface Terminal {
  id: string;
  pos_id?: number | string | null;
  store_id?: number | string | null;
  external_pos_id?: string | null;
  operating_mode?: string | null;
}

export function PointTerminalsPanel() {
  const { toast } = useToast();
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [isSandbox, setIsSandbox] = useState(false);

  const loadTerminals = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("point-terminals", {
        body: { action: "list" },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: "Mercado Pago", description: data.error, variant: "destructive" });
        setTerminals([]);
      } else {
        setTerminals(data?.terminals ?? []);
      }
      setIsSandbox(!!data?.is_sandbox);
      setLoaded(true);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Falha ao listar maquininhas", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = async (t: Terminal) => {
    const current = (t.operating_mode || "").toUpperCase();
    const next = current === "PDV" ? "STANDALONE" : "PDV";
    setSavingId(t.id);
    try {
      const { data, error } = await supabase.functions.invoke("point-terminals", {
        body: { action: "set_mode", terminal_id: t.id, operating_mode: next },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: "Mercado Pago", description: data.error, variant: "destructive" });
      } else {
        toast({
          title: "Modo atualizado",
          description: `Maquininha ${t.id} agora está em ${next === "PDV" ? "PDV (integrada)" : "STANDALONE (avulsa)"}.`,
        });
        setTerminals((prev) =>
          prev.map((x) => (x.id === t.id ? { ...x, operating_mode: next } : x)),
        );
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Falha ao alterar modo", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              Maquininhas Point (diagnóstico)
            </CardTitle>
            <CardDescription>
              Lista os terminais Point Smart da aplicação e o modo de operação.{" "}
              <strong>PDV</strong> = integrada (o sistema comanda a cobrança).{" "}
              <strong>STANDALONE</strong> = avulsa (operador digita o valor na máquina).
            </CardDescription>
          </div>
          <Button onClick={loadTerminals} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {loaded ? "Atualizar" : "Listar maquininhas"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isSandbox && (
          <div className="flex items-center gap-2 text-sm rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2">
            <FlaskConical className="h-4 w-4 shrink-0" />
            Usando credenciais de <strong>teste</strong>. As maquininhas físicas reais só aparecem com o token de produção.
          </div>
        )}

        {loaded && terminals.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-md border border-dashed px-3 py-6 justify-center">
            <AlertTriangle className="h-4 w-4" />
            Nenhuma maquininha encontrada para esta aplicação.
          </div>
        )}

        {terminals.length > 0 && (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Terminal (ID)</TableHead>
                  <TableHead>POS / Caixa</TableHead>
                  <TableHead>Loja</TableHead>
                  <TableHead>Modo</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terminals.map((t) => {
                  const mode = (t.operating_mode || "").toUpperCase();
                  const isPdv = mode === "PDV";
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.id}</TableCell>
                      <TableCell>{t.pos_id ?? t.external_pos_id ?? "—"}</TableCell>
                      <TableCell>{t.store_id ?? "—"}</TableCell>
                      <TableCell>
                        {isPdv ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600 gap-1">
                            <CheckCircle2 className="h-3 w-3" /> PDV
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> {mode || "STANDALONE"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={savingId === t.id}
                          onClick={() => toggleMode(t)}
                        >
                          {savingId === t.id
                            ? "Salvando..."
                            : isPdv
                            ? "Mudar p/ STANDALONE"
                            : "Ativar PDV"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
