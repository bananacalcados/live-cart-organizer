import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Trash2, CalendarDays } from "lucide-react";

interface Purchase {
  id: string;
  product_name: string;
  cor: string | null;
  tipo_grade: string | null;
  grades_qty: number;
  unit_cost: number;
  total_cost: number;
  arrival_date: string;
  received: boolean;
}

const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/** Grades compradas e suas datas de chegada. */
export function ExpArrivalsDialog({ open, onOpenChange }: Props) {
  const [rows, setRows] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("expedition_grade_purchases")
      .select("*")
      .order("arrival_date", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data as Purchase[]) || []);
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const toggleReceived = async (r: Purchase) => {
    const { error } = await (supabase as any)
      .from("expedition_grade_purchases")
      .update({ received: !r.received })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    setRows((p) => p.map((x) => (x.id === r.id ? { ...x, received: !x.received } : x)));
  };

  const remove = async (r: Purchase) => {
    const { error } = await (supabase as any).from("expedition_grade_purchases").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    setRows((p) => p.filter((x) => x.id !== r.id));
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">📅 Data de chegada das grades</DialogTitle>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1 pr-2">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">
              Nenhuma grade marcada como comprada ainda. Use o botão "Comprado" no relatório de grades.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const late = !r.received && r.arrival_date < today;
                return (
                  <div
                    key={r.id}
                    className={`flex items-center gap-3 rounded-xl border-2 p-3 ${
                      r.received
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : late
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-border"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-black">{r.product_name}</div>
                      <div className="text-sm font-semibold text-muted-foreground">
                        {r.cor || "—"} · {r.grades_qty} {r.tipo_grade === "letras" ? "un." : "grade(s)"} ·{" "}
                        {brl(r.total_cost)}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-base font-black ${late ? "border-destructive text-destructive" : ""}`}
                    >
                      <CalendarDays className="mr-1 h-4 w-4" /> {fmtDate(r.arrival_date)}
                    </Badge>
                    <Button
                      size="sm"
                      variant={r.received ? "default" : "outline"}
                      className="font-bold"
                      onClick={() => toggleReceived(r)}
                    >
                      {r.received ? "Recebida" : "Marcar recebida"}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
