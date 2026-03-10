import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, XCircle, RotateCcw } from "lucide-react";

interface StockAlert {
  id: string;
  event_id: string;
  product_title: string;
  variant: string | null;
  sku: string | null;
  image_url: string | null;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface EventStockAlertsProps {
  eventId: string;
}

// Audio for alert
let alertAudio: HTMLAudioElement | null = null;
const playAlertSound = () => {
  try {
    if (!alertAudio) {
      alertAudio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgipuYf19NVX2Nk4x2YVljdYiKgnBhXWRxfoOBdm1obHJ3eHVwbGtucXNzcG5sbG5wcnJwbm1sbnBycnBubWxucHJycG5tbG5wcnJwbm1sbnBycnBubWxucHJycG5tbG5wcnJwbm0=");
    }
    alertAudio.currentTime = 0;
    alertAudio.play().catch(() => {});
  } catch {}
};

export function EventStockAlerts({ eventId }: EventStockAlertsProps) {
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    const { data } = await supabase
      .from("event_stock_alerts")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(20);
    setAlerts((data as unknown as StockAlert[]) || []);
  }, [eventId]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  // Realtime subscription for new alerts
  useEffect(() => {
    const channel = supabase
      .channel(`stock-alerts-${eventId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "event_stock_alerts",
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const newAlert = payload.new as StockAlert;
        setAlerts((prev) => [newAlert, ...prev]);
        playAlertSound();
        toast.warning(`⚠️ Alerta de estoque: ${newAlert.product_title} ${newAlert.variant || ""}`, {
          duration: 10000,
        });
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "event_stock_alerts",
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const updated = payload.new as StockAlert;
        setAlerts((prev) => prev.map((a) => a.id === updated.id ? updated : a));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [eventId]);

  const resolveAlert = async (alertId: string, status: "has_stock" | "no_stock" | "wrong_product") => {
    setResolving(alertId);
    const { error } = await supabase
      .from("event_stock_alerts")
      .update({ status, resolved_at: new Date().toISOString(), resolved_by: "operator" })
      .eq("id", alertId);
    
    if (error) toast.error("Erro ao resolver alerta");
    else toast.success("Alerta resolvido!");
    setResolving(null);
  };

  const pendingAlerts = alerts.filter((a) => a.status === "pending");
  const resolvedAlerts = alerts.filter((a) => a.status !== "pending");

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-3">
      {pendingAlerts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-destructive flex items-center gap-1">
            <AlertTriangle className="h-4 w-4 animate-pulse" />
            Alertas Pendentes ({pendingAlerts.length})
          </h3>
          {pendingAlerts.map((alert) => (
            <Card key={alert.id} className="border-destructive/50 bg-destructive/5 animate-pulse">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  {alert.image_url && (
                    <img src={alert.image_url} className="h-12 w-12 rounded object-cover" alt="" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{alert.product_title}</p>
                    {alert.variant && <p className="text-xs text-muted-foreground">{alert.variant}</p>}
                    {alert.sku && <Badge variant="outline" className="text-[10px] mt-0.5">SKU: {alert.sku}</Badge>}
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-stage-paid border-stage-paid/30 hover:bg-stage-paid/10"
                    disabled={resolving === alert.id}
                    onClick={() => resolveAlert(alert.id, "has_stock")}
                  >
                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Tem produto
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                    disabled={resolving === alert.id}
                    onClick={() => resolveAlert(alert.id, "no_stock")}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Sem estoque
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-stage-awaiting border-stage-awaiting/30 hover:bg-stage-awaiting/10"
                    disabled={resolving === alert.id}
                    onClick={() => resolveAlert(alert.id, "wrong_product")}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Produto errado
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {resolvedAlerts.length > 0 && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
            Alertas resolvidos ({resolvedAlerts.length})
          </summary>
          <div className="space-y-1 mt-1">
            {resolvedAlerts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 p-1.5 rounded bg-muted/30">
                {a.status === "has_stock" && <CheckCircle className="h-3 w-3 text-stage-paid" />}
                {a.status === "no_stock" && <XCircle className="h-3 w-3 text-destructive" />}
                {a.status === "wrong_product" && <RotateCcw className="h-3 w-3 text-stage-awaiting" />}
                <span className="truncate">{a.product_title} {a.variant || ""}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// Function to create a stock alert and notify team via WhatsApp
export async function createStockAlert(
  eventId: string,
  product: { title: string; variant?: string; sku?: string; image?: string }
) {
  // Insert alert
  const { data: alert, error } = await supabase
    .from("event_stock_alerts")
    .insert({
      event_id: eventId,
      product_title: product.title,
      variant: product.variant || null,
      sku: product.sku || null,
      image_url: product.image || null,
    })
    .select()
    .single();

  if (error) {
    toast.error("Erro ao criar alerta de estoque");
    return;
  }

  // Get team members assigned to this event
  const { data: assignments } = await supabase
    .from("event_team_assignments")
    .select("team_member_id")
    .eq("event_id", eventId);

  if (!assignments || assignments.length === 0) return;

  const memberIds = assignments.map((a: any) => a.team_member_id);
  const { data: members } = await supabase
    .from("event_team_members")
    .select("*")
    .in("id", memberIds);

  if (!members) return;

  // Get event's whatsapp number (based on store)
  const { data: eventData } = await supabase
    .from("events")
    .select("name")
    .eq("id", eventId)
    .single();

  // Send WhatsApp to each team member with a phone
  const message = `⚠️ *ALERTA DE ESTOQUE*\n\n📦 *${product.title}*${product.variant ? `\n📏 ${product.variant}` : ""}${product.sku ? `\nSKU: ${product.sku}` : ""}\n\n🔴 Verificar estoque urgente!\n\n_Evento: ${eventData?.name || "Live"}_`;

  for (const member of members) {
    if (!(member as any).whatsapp) continue;
    try {
      await supabase.functions.invoke("zapi-send-message", {
        body: {
          phone: (member as any).whatsapp,
          message,
        },
      });
    } catch (e) {
      console.error(`Failed to send alert to ${(member as any).name}:`, e);
    }
  }

  toast.success("Alerta de estoque enviado para a equipe!");
}
