import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Search, CheckCircle2, AlertTriangle, XCircle, Link2, ShoppingBag, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

type GreenItem = {
  variant_id: string;
  master_id: string;
  shopify_product_id: string;
  shopify_variant_id: string;
  shopify_title: string;
  shopify_sku: string;
  shopify_barcode: string;
  our_sku: string;
  our_gtin: string;
  matched_by: "gtin" | "sku" | string;
};

type OtherItem = GreenItem & { reason?: string };

type DryRun = {
  summary: {
    shopify_products: number;
    shopify_variants: number;
    pages: number;
    green: number;
    yellow: number;
    red: number;
    our_variants_indexed: number;
  };
  green: GreenItem[];
  yellow: OtherItem[];
  red: OtherItem[];
  yellow_total: number;
  red_total: number;
};

export function ShopifyLinkManager() {
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [report, setReport] = useState<DryRun | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function runDryRun() {
    setLoading(true);
    setReport(null);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-link-products", {
        body: { mode: "dry_run" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setReport(data as DryRun);
      toast.success(
        `Conferência concluída: ${data.summary.green} prontos, ${data.summary.yellow} para revisar, ${data.summary.red} sem par`,
      );
    } catch (err: any) {
      toast.error("Erro na conferência: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!report?.green?.length) return;
    setCommitting(true);
    setConfirmOpen(false);
    try {
      const links = report.green.map((g) => ({
        variant_id: g.variant_id,
        master_id: g.master_id,
        shopify_product_id: g.shopify_product_id,
        shopify_variant_id: g.shopify_variant_id,
      }));
      const { data, error } = await supabase.functions.invoke("shopify-link-products", {
        body: { mode: "commit", links },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Vínculos gravados: ${data.linked} variações vinculadas à Shopify`);
      // Atualiza o relatório pra refletir que já foi gravado
      await runDryRun();
    } catch (err: any) {
      toast.error("Erro ao gravar vínculos: " + (err.message || err));
    } finally {
      setCommitting(false);
    }
  }

  const s = report?.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            Vincular anúncios da Shopify ao nosso catálogo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground space-y-1">
            <p>
              Casa cada anúncio da Shopify com nossos produtos por <strong>código de barras (GTIN)</strong> e,
              em segundo critério, por <strong>SKU</strong>. Nada é gravado na conferência — você revisa antes.
            </p>
            <p className="text-amber-600 dark:text-amber-500">
              ⚠️ Depois de vincular, desligue a sincronização <strong>Tiny → Shopify</strong> no painel do Tiny.
              Senão o Tiny continua sobrescrevendo o estoque na Shopify.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={runDryRun} disabled={loading || committing} className="gap-1">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {report ? "Refazer conferência" : "Fazer conferência"}
            </Button>
            {report && report.green.length > 0 && (
              <Button
                variant="default"
                onClick={() => setConfirmOpen(true)}
                disabled={loading || committing}
                className="gap-1"
              >
                {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Confirmar {report.green.length} vínculos
              </Button>
            )}
          </div>

          {s && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Anúncios Shopify" value={s.shopify_variants} sub={`${s.shopify_products} produtos`} />
              <StatCard label="Prontos (verde)" value={s.green} icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} />
              <StatCard label="Revisar (amarelo)" value={s.yellow} icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} />
              <StatCard label="Sem par (vermelho)" value={s.red} icon={<XCircle className="h-4 w-4 text-red-600" />} />
            </div>
          )}
        </CardContent>
      </Card>

      {report && (
        <Card>
          <CardContent className="pt-4">
            <Tabs defaultValue="green">
              <TabsList>
                <TabsTrigger value="green" className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Prontos ({report.summary.green})
                </TabsTrigger>
                <TabsTrigger value="yellow" className="gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Revisar ({report.yellow_total})
                </TabsTrigger>
                <TabsTrigger value="red" className="gap-1">
                  <XCircle className="h-3.5 w-3.5 text-red-600" /> Sem par ({report.red_total})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="green">
                <LinkTable rows={report.green.slice(0, 500)} kind="green" total={report.summary.green} />
              </TabsContent>
              <TabsContent value="yellow">
                <LinkTable rows={report.yellow} kind="yellow" total={report.yellow_total} />
              </TabsContent>
              <TabsContent value="red">
                <LinkTable rows={report.red} kind="red" total={report.red_total} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar vínculos?</AlertDialogTitle>
            <AlertDialogDescription>
              Vou gravar {report?.green.length} vínculos entre nossos produtos e os anúncios da Shopify.
              Isso só grava os identificadores da Shopify nos nossos registros — não altera nada na Shopify
              nem no Tiny. Depois disso, lembre de desligar a sincronização Tiny → Shopify.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={commit}>Confirmar e gravar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: number; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-bold">{value.toLocaleString("pt-BR")}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function LinkTable({ rows, kind, total }: { rows: OtherItem[]; kind: "green" | "yellow" | "red"; total: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Nenhum item nesta lista.</p>;
  }
  return (
    <div className="space-y-2">
      {total > rows.length && (
        <p className="text-xs text-muted-foreground">
          Mostrando {rows.length} de {total.toLocaleString("pt-BR")} itens.
        </p>
      )}
      <div className="rounded-md border max-h-[480px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Anúncio (Shopify)</TableHead>
              <TableHead>SKU Shopify</TableHead>
              <TableHead>Barcode Shopify</TableHead>
              {kind !== "red" && <TableHead>Casou por</TableHead>}
              {kind === "yellow" && <TableHead>Motivo</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.shopify_variant_id}>
                <TableCell className="max-w-[260px] truncate">{r.shopify_title || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.shopify_sku || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.shopify_barcode || "—"}</TableCell>
                {kind !== "red" && (
                  <TableCell>
                    <Badge variant={r.matched_by === "gtin" ? "default" : "secondary"} className="text-[10px]">
                      {r.matched_by === "gtin" ? "Código de barras" : "SKU"}
                    </Badge>
                  </TableCell>
                )}
                {kind === "yellow" && (
                  <TableCell className="text-xs text-amber-600">{r.reason || "—"}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
