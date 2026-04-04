import { useState, useEffect } from "react";
import {
  Bot, Camera, MessageSquare, PackageSearch, HelpCircle,
  Check, Loader2, Clock, User, Phone, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  storeId: string;
}

interface AiRequest {
  id: string;
  request_type: string;
  status: string;
  customer_phone: string | null;
  customer_name: string | null;
  product_title: string | null;
  shopify_product_id: string | null;
  store_id: string | null;
  ai_agent: string;
  ai_summary: string;
  priority: string;
  seller_id: string | null;
  response_notes: string | null;
  whatsapp_number_id: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Camera; color: string }> = {
  product_photo: { label: "📸 Foto de Produto", icon: Camera, color: "bg-blue-500/20 text-blue-400" },
  takeover_chat: { label: "💬 Assumir Atendimento", icon: MessageSquare, color: "bg-purple-500/20 text-purple-400" },
  verify_stock: { label: "📦 Verificar Estoque", icon: PackageSearch, color: "bg-yellow-500/20 text-yellow-400" },
  technical_info: { label: "❓ Info Técnica", icon: HelpCircle, color: "bg-green-500/20 text-green-400" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Aguardando", color: "bg-orange-500/20 text-orange-400 animate-pulse" },
  in_progress: { label: "Em andamento", color: "bg-blue-500/20 text-blue-400" },
  completed: { label: "Concluída", color: "bg-green-500/20 text-green-400" },
  expired: { label: "Expirada", color: "bg-gray-500/20 text-gray-400" },
};

export function POSAiAssistanceRequests({ storeId }: Props) {
  const [requests, setRequests] = useState<AiRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  useEffect(() => {
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    loadRequests();

    const channel = supabase
      .channel("ai-assistance-realtime")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "ai_assistance_requests",
      }, (payload) => {
        loadRequests();
        // Push browser notification
        const req = payload.new as any;
        if (req.status === "pending") {
          const typeLabel = TYPE_CONFIG[req.request_type]?.label || "Solicitação";
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("🤖 Nova solicitação da IA", {
              body: `${typeLabel}: ${req.ai_summary?.slice(0, 100)}`,
              icon: "/placeholder.svg",
              tag: `ai-request-${req.id}`,
            });
          }
          // Also play a sound
          try {
            const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JkZeYl5KNiIaCgoSIjZKWmJmXk46JhYKBgoaLkJWYmZiUj4qGgoGChYuQlZiZmJSPioWCgYKGi5CVmJmYlI+KhYKBgoaLkJWYmZiUj4qFgoGChg==");
            audio.volume = 0.3;
            audio.play().catch(() => {});
          } catch {}
        }
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "ai_assistance_requests",
      }, () => {
        loadRequests();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [storeId]);

  const loadRequests = async () => {
    setLoading(true);
    let query = supabase
      .from("ai_assistance_requests")
      .select("*")
      .order("created_at", { ascending: false });

    // Show requests for this store OR unassigned
    query = query.or(`store_id.eq.${storeId},store_id.is.null`);

    const { data } = await query.limit(100);
    setRequests((data as AiRequest[]) || []);
    setLoading(false);
  };

  const handleClaim = async (id: string) => {
    setClaimingId(id);
    try {
      const { error } = await supabase
        .from("ai_assistance_requests")
        .update({
          status: "in_progress",
          claimed_at: new Date().toISOString(),
        } as any)
        .eq("id", id);

      if (error) throw error;
      toast.success("Solicitação assumida!");
      loadRequests();
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setClaimingId(null);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      const { error } = await supabase
        .from("ai_assistance_requests")
        .update({
          status: "completed",
          response_notes: responseText || null,
          completed_at: new Date().toISOString(),
        } as any)
        .eq("id", id);

      if (error) throw error;
      toast.success("Solicitação concluída!");
      setCompletingId(null);
      setResponseText("");
      loadRequests();
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    }
  };

  const pendingCount = requests.filter(r => r.status === "pending").length;
  const inProgressCount = requests.filter(r => r.status === "in_progress").length;

  const displayed = filter === "pending"
    ? requests.filter(r => r.status === "pending" || r.status === "in_progress")
    : requests;

  const timeSince = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-1.5">
          <Clock className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-xs font-bold text-orange-400">{pendingCount} pendentes</span>
        </div>
        {inProgressCount > 0 && (
          <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-1.5">
            <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />
            <span className="text-xs font-bold text-blue-400">{inProgressCount} em andamento</span>
          </div>
        )}
        <div className="ml-auto">
          <button
            onClick={() => setFilter(f => f === "pending" ? "all" : "pending")}
            className="text-[10px] text-pos-white/40 hover:text-pos-white/60 underline"
          >
            {filter === "pending" ? "Ver todas" : "Só pendentes"}
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-pos-orange" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-8 text-pos-white/40">
          <Bot className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhuma solicitação da IA</p>
          <p className="text-[10px] mt-1">Quando a IA precisar de ajuda, aparecerá aqui</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map(req => {
            const typeConf = TYPE_CONFIG[req.request_type] || TYPE_CONFIG.technical_info;
            const statusConf = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending;
            const TypeIcon = typeConf.icon;

            return (
              <Card key={req.id} className={`border-pos-orange/10 ${req.status === "pending" ? "bg-orange-500/5 border-orange-500/20" : "bg-pos-white/5"}`}>
                <CardContent className="p-3">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {req.priority === "urgent" && (
                        <Badge className="bg-red-500 text-white border-0 text-[9px] px-1.5">URGENTE</Badge>
                      )}
                      <Badge className={`text-[9px] ${typeConf.color} border-0`}>
                        <TypeIcon className="h-2.5 w-2.5 mr-0.5" />
                        {typeConf.label}
                      </Badge>
                      <Badge className={`text-[9px] ${statusConf.color} border-0`}>
                        {statusConf.label}
                      </Badge>
                    </div>
                    <span className="text-[9px] text-pos-white/40 whitespace-nowrap ml-2">
                      {timeSince(req.created_at)}
                    </span>
                  </div>

                  {/* AI Summary */}
                  <p className="text-xs text-pos-white/80 mb-2 leading-relaxed">
                    🤖 <span className="font-medium text-pos-orange">{req.ai_agent.toUpperCase()}</span>: {req.ai_summary}
                  </p>

                  {/* Product */}
                  {req.product_title && (
                    <p className="text-[11px] text-pos-white/50 mb-1">
                      📦 {req.product_title}
                    </p>
                  )}

                  {/* Customer */}
                  {(req.customer_name || req.customer_phone) && (
                    <div className="flex items-center gap-2 text-[11px] text-pos-white/50 mb-2">
                      <User className="h-3 w-3" />
                      <span>{req.customer_name || "Cliente"}</span>
                      {req.customer_phone && (
                        <a
                          href={`https://wa.me/${req.customer_phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener"
                          className="flex items-center gap-0.5 text-green-400 hover:text-green-300"
                        >
                          <Phone className="h-2.5 w-2.5" />
                          {req.customer_phone}
                          <ExternalLink className="h-2 w-2" />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Response notes */}
                  {req.response_notes && req.status === "completed" && (
                    <p className="text-[10px] text-green-400/70 mt-1">✅ {req.response_notes}</p>
                  )}

                  {/* Actions */}
                  {req.status === "pending" && (
                    <Button
                      size="sm"
                      className="mt-2 w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold text-xs h-8 gap-1"
                      onClick={() => handleClaim(req.id)}
                      disabled={claimingId === req.id}
                    >
                      {claimingId === req.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      Assumir Solicitação
                    </Button>
                  )}

                  {req.status === "in_progress" && completingId !== req.id && (
                    <Button
                      size="sm"
                      className="mt-2 w-full bg-green-600 text-white hover:bg-green-700 font-bold text-xs h-8 gap-1"
                      onClick={() => setCompletingId(req.id)}
                    >
                      <Check className="h-3 w-3" /> Marcar como Concluída
                    </Button>
                  )}

                  {completingId === req.id && (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={responseText}
                        onChange={e => setResponseText(e.target.value)}
                        placeholder="Observação (opcional)..."
                        className="h-14 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white resize-none"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 bg-green-600 text-white hover:bg-green-700 text-xs h-7"
                          onClick={() => handleComplete(req.id)}
                        >
                          ✅ Concluir
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-pos-white/50 text-xs h-7"
                          onClick={() => { setCompletingId(null); setResponseText(""); }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
