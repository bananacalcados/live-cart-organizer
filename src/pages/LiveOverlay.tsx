import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { OverlayConfig, fill, withOverlayDefaults } from "@/lib/liveOverlay";

interface OvEvent { id: number; kind: string; payload: any; created_at: string }
interface Alert { key: number; text: string; duration: number }

/**
 * Overlay da Live para o OBS (1080x1920, fundo transparente).
 * Lê SOMENTE a função overlay_pull (a cada 2 s). Nenhuma outra consulta.
 */
export default function LiveOverlay() {
  const { token } = useParams();
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [hidden, setHidden] = useState(false);
  const [raffleCount, setRaffleCount] = useState(0);
  const [tickerIdx, setTickerIdx] = useState(0);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [cta, setCta] = useState<string | null>(null);
  const lastId = useRef(0);
  const queue = useRef<Alert[]>([]);
  const ctaIdx = useRef(0);
  const ctaTimer = useRef<number | null>(null);
  const cfgRef = useRef<OverlayConfig | null>(null);
  const cfgKey = useRef("");

  useEffect(() => {
    const resize = () => setViewport((current) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      return current.width === width && current.height === height ? current : { width, height };
    });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Fundo transparente para o OBS
  useEffect(() => {
    const prev = [document.body.style.background, document.documentElement.style.background];
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => {
      document.body.style.background = prev[0];
      document.documentElement.style.background = prev[1];
    };
  }, []);

  const showCta = (text: string) => {
    setCta(text);
    if (ctaTimer.current) window.clearTimeout(ctaTimer.current);
    ctaTimer.current = window.setTimeout(() => setCta(null), 12000);
  };

  // Polling
  useEffect(() => {
    if (!token) return;
    let stop = false;
    const pull = async () => {
      const { data } = await supabase.rpc("overlay_pull" as any, { p_token: token, p_after_id: lastId.current });
      if (stop || !data || (data as any).error) return;
      const d = data as any;
      const key = JSON.stringify(d.settings?.config || {});
      if (key !== cfgKey.current) {
        cfgKey.current = key;
        const c = withOverlayDefaults(d.settings?.config);
        cfgRef.current = c;
        setConfig(c);
      }
      setHidden(!!d.settings?.hidden);
      setRaffleCount((v) => (v === d.raffle_count ? v : d.raffle_count || 0));
      if (lastId.current === 0) lastId.current = d.last_id || 0;
      const cfg = cfgRef.current;
      for (const e of (d.events || []) as OvEvent[]) {
        lastId.current = Math.max(lastId.current, e.id);
        if (!cfg) continue;
        if (Date.now() - new Date(e.created_at).getTime() > 120_000) continue;
        if (e.kind === "paid" && cfg.paid_alert.enabled && e.payload?.handle) {
          queue.current.push({ key: e.id, text: fill(cfg.paid_alert.template, e.payload), duration: cfg.paid_alert.duration_seconds });
        } else if (e.kind === "assembled" && cfg.assembled_alert.enabled && e.payload?.handle) {
          queue.current.push({ key: e.id, text: fill(cfg.assembled_alert.template, e.payload), duration: cfg.assembled_alert.duration_seconds });
        } else if (e.kind === "cta_now" && e.payload?.text) {
          showCta(e.payload.text);
        }
      }
    };
    pull();
    const t = window.setInterval(pull, 2000);
    return () => { stop = true; window.clearInterval(t); };
  }, [token]);

  // Fila de avisos: um por vez
  useEffect(() => {
    if (alert) {
      const t = window.setTimeout(() => setAlert(null), Math.max(2, alert.duration) * 1000);
      return () => window.clearTimeout(t);
    }
    const t = window.setInterval(() => {
      const next = queue.current.shift();
      if (next) setAlert(next);
    }, 500);
    return () => window.clearInterval(t);
  }, [alert]);

  // Faixa
  const tickerItems = (config?.ticker.items || []).filter((i) => i.enabled && i.text.trim());
  useEffect(() => {
    if (!config?.ticker.enabled || tickerItems.length < 2) return;
    const t = window.setInterval(() => setTickerIdx((i) => i + 1), Math.max(2, config.ticker.interval_seconds) * 1000);
    return () => window.clearInterval(t);
  }, [config?.ticker.enabled, config?.ticker.interval_seconds, tickerItems.length]);

  // CTAs periódicas
  useEffect(() => {
    if (!config?.cta.enabled) return;
    const items = config.cta.items.filter((i) => i.enabled && i.text.trim());
    if (!items.length) return;
    const t = window.setInterval(() => {
      const it = items[ctaIdx.current % items.length];
      ctaIdx.current += 1;
      showCta(it.text);
    }, Math.max(1, config.cta.interval_minutes) * 60_000);
    return () => window.clearInterval(t);
  }, [config?.cta]);

  if (!config) return null;
  const rb = config.raffle_bar;
  const remaining = Math.max(0, (rb.goal_count || 0) - raffleCount);
  const pct = rb.goal_count > 0 ? Math.min(100, (raffleCount / rb.goal_count) * 100) : 0;
  const tickerText = tickerItems.length ? tickerItems[tickerIdx % tickerItems.length].text : "";

  const panel = "bg-black/60 text-white rounded-3xl px-8 py-5 [text-shadow:0_2px_6px_rgba(0,0,0,0.9)]";
  const scale = Math.min(viewport.width / 1080, viewport.height / 1920);
  const offset = (viewport.width - 1080 * scale) / 2;

  return (
    <div className="fixed inset-0 overflow-hidden">
    <div
      className="absolute top-0 overflow-hidden font-sans"
      style={{ width: 1080, height: 1920, left: offset, transform: `scale(${scale})`, transformOrigin: "top left", background: "transparent", opacity: hidden ? 0 : 1, transition: "opacity 600ms ease" }}
    >
      {config.ticker.enabled && tickerText && (
        <div className="absolute left-10 right-10 flex justify-center" style={{ top: 200 }}>
          <div key={tickerIdx} className={`${panel} text-center font-bold animate-in fade-in duration-700`} style={{ fontSize: 40 }}>
            {tickerText}
          </div>
        </div>
      )}

      {rb.enabled && (
        <div className="absolute left-10 right-10 flex justify-center" style={{ top: 330 }}>
          <div className={`${panel} w-full text-center font-bold`} style={{ fontSize: 36 }}>
            {fill(rb.text_template, { count: raffleCount })}
            {rb.goal_enabled && rb.goal_count > 0 && (
              <>
                <div className="mt-3 h-6 w-full overflow-hidden rounded-full bg-white/25">
                  <div className="h-full rounded-full bg-amber-400 transition-all duration-700" style={{ width: `${pct}%` }} />
                </div>
                {remaining > 0 && <div className="mt-2" style={{ fontSize: 34 }}>{fill(rb.goal_text, { remaining, count: raffleCount })}</div>}
              </>
            )}
          </div>
        </div>
      )}

      {alert && (
        <div className="absolute left-8" style={{ top: 820, maxWidth: 560 }}>
          <div key={alert.key} className={`${panel} font-extrabold animate-in slide-in-from-left fade-in duration-500`} style={{ fontSize: 42, lineHeight: 1.2 }}>
            {alert.text}
          </div>
        </div>
      )}

      {cta && (
        <div className="absolute left-10 right-10 flex justify-center" style={{ bottom: 440 }}>
          <div className={`${panel} text-center font-extrabold animate-in fade-in zoom-in-95 duration-500`} style={{ fontSize: 42 }}>
            {cta}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
