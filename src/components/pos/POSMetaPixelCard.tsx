import { useEffect, useState } from "react";
import { Activity, CheckCircle2, AlertCircle, ChevronRight, Loader2 } from "lucide-react";
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
      className={`w-full text-left bg-white hover:bg-orange-50/40 border ${hasErrors ? "border-red-400/60 ring-1 ring-red-300/30" : "border-orange-200/60"} rounded-2xl p-4 transition-all group shadow-[var(--shadow-pos-card)] hover:shadow-lg`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl ${hasErrors ? "bg-red-100 text-red-600" : "bg-orange-100 text-orange-600"}`}>
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-800">Meta Pixel</p>
            <p className="text-[11px] text-neutral-500">Auditoria de envios CAPI</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-neutral-400 group-hover:text-orange-500 transition" />
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-2">
            <div className="flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="text-lg font-bold leading-none">{sent}</span>
            </div>
            <p className="text-[10px] text-emerald-700/70 mt-1 font-medium">Enviados hoje</p>
          </div>
          <div className={`rounded-xl border p-2 ${hasErrors ? "bg-red-50 border-red-100" : "bg-neutral-50 border-neutral-100"}`}>
            <div className={`flex items-center gap-1 ${hasErrors ? "text-red-700" : "text-neutral-500"}`}>
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="text-lg font-bold leading-none">{errors}</span>
            </div>
            <p className={`text-[10px] mt-1 font-medium ${hasErrors ? "text-red-700/70" : "text-neutral-500"}`}>Erros hoje</p>
          </div>
          <div className={`rounded-xl border p-2 ${rate >= 95 ? "bg-emerald-50 border-emerald-100" : rate >= 80 ? "bg-amber-50 border-amber-100" : "bg-red-50 border-red-100"}`}>
            <div className={`text-lg font-bold leading-none ${rate >= 95 ? "text-emerald-700" : rate >= 80 ? "text-amber-700" : "text-red-700"}`}>
              {rate.toFixed(0)}%
            </div>
            <p className={`text-[10px] mt-1 font-medium ${rate >= 95 ? "text-emerald-700/70" : rate >= 80 ? "text-amber-700/70" : "text-red-700/70"}`}>Taxa sucesso</p>
          </div>
        </div>
      )}
    </button>
  );
}
