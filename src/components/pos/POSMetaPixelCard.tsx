import { useEffect, useState } from "react";
import { Activity, CheckCircle2, AlertCircle, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  onOpen: () => void;
}

export function POSMetaPixelCard({ onOpen }: Props) {
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(0);
  const [errors, setErrors] = useState(0);
  const [rate, setRate] = useState(100);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const since = today.toISOString();

        const [offline, live] = await Promise.all([
          supabase.from("meta_capi_offline_log").select("status").gte("created_at", since),
          supabase.from("meta_capi_purchase_log").select("status").gte("created_at", since),
        ]);
        const all = [...(offline.data || []), ...(live.data || [])];
        const s = all.filter((r: any) => r.status === "sent").length;
        const e = all.filter((r: any) => r.status === "error").length;
        const total = s + e;
        setSent(s);
        setErrors(e);
        setRate(total > 0 ? (s / total) * 100 : 100);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const hasErrors = errors > 0;

  return (
    <button
      onClick={onOpen}
      className={`w-full text-left bg-white/5 hover:bg-white/[0.08] border ${hasErrors ? "border-red-500/40" : "border-white/10"} rounded-xl p-4 transition-all group`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg ${hasErrors ? "bg-red-500/15 text-red-400" : "bg-pos-yellow/15 text-pos-yellow"}`}>
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Meta Pixel</p>
            <p className="text-[10px] text-white/50">Auditoria de envios CAPI</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-white/40 group-hover:text-white/80 transition" />
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              <span className="text-lg font-bold">{sent}</span>
            </div>
            <p className="text-[10px] text-white/50">Enviados hoje</p>
          </div>
          <div>
            <div className="flex items-center gap-1 text-red-400">
              <AlertCircle className="h-3 w-3" />
              <span className="text-lg font-bold">{errors}</span>
            </div>
            <p className="text-[10px] text-white/50">Erros hoje</p>
          </div>
          <div>
            <div className={`text-lg font-bold ${rate >= 95 ? "text-emerald-400" : rate >= 80 ? "text-amber-400" : "text-red-400"}`}>
              {rate.toFixed(0)}%
            </div>
            <p className="text-[10px] text-white/50">Taxa sucesso</p>
          </div>
        </div>
      )}
    </button>
  );
}
