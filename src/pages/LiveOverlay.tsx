import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { OverlayConfig, PaymentTimer, fill, formatTimer, visibleTimers, withOverlayDefaults } from "@/lib/liveOverlay";
import { OverlayBlock } from "@/components/events/OverlayBlock";

interface OvEvent { id: number; kind: string; payload: any; created_at: string }
interface Alert { key: number; text: string; duration: number; tone?: "expired" }

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
  const [spin, setSpin] = useState<{ key: number; handle: string; text: string; done: boolean } | null>(null);
  const spinQueue = useRef<{ key: number; handle: string; labels: string[]; winner: string }[]>([]);
  const spinBusy = useRef(false);
  const lastId = useRef(0);
  const queue = useRef<Alert[]>([]);
  const ctaIdx = useRef(0);
  const ctaTimer = useRef<number | null>(null);
  const cfgRef = useRef<OverlayConfig | null>(null);
  const cfgKey = useRef("");
  const [timers, setTimers] = useState<PaymentTimer[]>([]);
  const [now, setNow] = useState(() => Date.now());

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

  // Roleta: troca o texto do prêmio cada vez mais devagar até parar no sorteado
  const runSpin = () => {
    if (spinBusy.current) return;
    const s = spinQueue.current.shift();
    if (!s) return;
    spinBusy.current = true;
    const labels = s.labels.length ? s.labels : [s.winner];
    let i = 0; let delay = 70; let elapsed = 0;
    const step = () => {
      if (elapsed >= 6000) {
        setSpin({ key: s.key, handle: s.handle, text: s.winner, done: true });
        const secs = Math.max(3, cfgRef.current?.wheel.result_seconds || 8);
        window.setTimeout(() => { setSpin(null); spinBusy.current = false; runSpin(); }, secs * 1000);
        return;
      }
      setSpin({ key: s.key, handle: s.handle, text: labels[i % labels.length], done: false });
      i += 1; elapsed += delay; delay = Math.min(450, delay * 1.08);
      window.setTimeout(step, delay);
    };
    step();
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
        const p = e.payload || {};
        if (e.kind === "paid" && p.order_id) setTimers((list) => list.filter((t) => t.orderId !== p.order_id));
        if (e.kind === "expired" && p.order_id) setTimers((list) => list.filter((t) => t.orderId !== p.order_id));
        if ((e.kind === "timer" || e.kind === "assembled") && p.expires_at && p.order_id && cfg.payment_timers.enabled) {
          const t: PaymentTimer = { orderId: p.order_id, handle: p.handle || "cliente", product: p.product || "", size: p.size || "", expiresAt: new Date(p.expires_at).getTime(), addedAt: new Date(e.created_at).getTime() };
          setTimers((list) => [...list.filter((x) => x.orderId !== t.orderId), t]);
          continue;
        }
        if (e.kind === "expired") {
          if (cfg.expired_alert.enabled) queue.current.push({ key: e.id, text: fill(expiredAlertTemplate(cfg.expired_alert, p), { handle: p.handle || "", product: p.product || "par", size: p.size || "número" }), duration: cfg.expired_alert.duration_seconds, tone: "expired" });
          continue;
        }
        if (e.kind === "paid" && cfg.paid_alert.enabled && e.payload?.handle) {
          queue.current.push({ key: e.id, text: fill(cfg.paid_alert.template, e.payload), duration: cfg.paid_alert.duration_seconds });
        } else if (e.kind === "assembled" && cfg.assembled_alert.enabled && e.payload?.handle) {
          queue.current.push({ key: e.id, text: fill(cfg.assembled_alert.template, e.payload), duration: cfg.assembled_alert.duration_seconds });
        } else if (e.kind === "wheel_spin" && cfg.wheel.enabled && e.payload?.winner_label) {
          spinQueue.current.push({ key: e.id, handle: e.payload.handle || "cliente", labels: (e.payload.labels || []).filter(Boolean), winner: e.payload.winner_label });
          runSpin();
        } else if (e.kind === "cta_now" && e.payload?.text) {
          showCta(e.payload.text);
        }
      }
    };
    pull();
    const t = window.setInterval(pull, 2000);
    return () => { stop = true; window.clearInterval(t); };
  }, [token]);

  // Relógio local (1 s) só enquanto há relógios na tela — não consulta o servidor
  useEffect(() => {
    if (!timers.length) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      setTimers((list) => { const keep = list.filter((x) => x.expiresAt > n && n - x.addedAt < 20 * 60_000); return keep.length === list.length ? list : keep; });
    }, 1000);
    return () => window.clearInterval(t);
  }, [timers.length]);

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

  const panel = "overlay-panel";
  const scale = Math.min(viewport.width / 1080, viewport.height / 1920);
  const offset = (viewport.width - 1080 * scale) / 2;

  return (
    <div className="fixed inset-0 overflow-hidden">
    <div
      className="absolute top-0 overflow-hidden font-sans"
      style={{ width: 1080, height: 1920, left: offset, transform: `scale(${scale})`, transformOrigin: "top left", background: "transparent", opacity: hidden ? 0 : 1, transition: "opacity 600ms ease" }}
    >
      {config.ticker.enabled && tickerText && (
        <OverlayBlock position={config.layout.ticker} blockKey="ticker">
          <div key={tickerIdx} className={`${panel} font-bold animate-in fade-in duration-700`}>
            {tickerText}
          </div>
        </OverlayBlock>
      )}

      {rb.enabled && (
        <OverlayBlock position={config.layout.raffle_bar} blockKey="raffle_bar">
          <div className={`${panel} w-full font-bold`}>
            {fill(rb.text_template, { count: raffleCount })}
            {rb.goal_enabled && rb.goal_count > 0 && (
              <>
                <div className="overlay-progress-track mt-[0.25em] h-[0.28em] w-full overflow-hidden rounded-full">
                  <div className="overlay-progress-fill h-full rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                </div>
                {remaining > 0 && <div className="mt-[0.3em]">{fill(rb.goal_text, { remaining, count: raffleCount })}</div>}
              </>
            )}
          </div>
        </OverlayBlock>
      )}

      {alert && (
        <OverlayBlock position={config.layout.alert} blockKey="alert">
          <div key={alert.key} className={`${panel} ${alert.tone === "expired" ? "overlay-alert-expired" : ""} font-extrabold animate-in slide-in-from-left fade-in duration-500`} style={{ lineHeight: 1.2 }}>
            {alert.text}
          </div>
        </OverlayBlock>
      )}

      {config.payment_timers.enabled && visibleTimers(timers, now).length > 0 && (
        <OverlayBlock position={config.layout.timers} blockKey="timers">
          <div className="flex flex-col gap-[0.3em]">
            {visibleTimers(timers, now).map((t) => (
              <div key={t.orderId} data-overlay-timer={t.orderId} className={`${panel} font-bold animate-in fade-in duration-500`} style={{ lineHeight: 1.2 }}>
                {fill(config.payment_timers.template, { handle: t.handle, product: t.product, size: t.size, timer: formatTimer(t.expiresAt - now) })
                  .split(formatTimer(t.expiresAt - now)).flatMap((part, i, arr) => i < arr.length - 1 ? [part, <span key={i} className="overlay-timer">{formatTimer(t.expiresAt - now)}</span>] : [part])}
              </div>
            ))}
          </div>
        </OverlayBlock>
      )}

      {spin && (
        <OverlayBlock position={config.layout.wheel} blockKey="wheel">
          <div key={spin.key} className={`${panel} font-extrabold animate-in fade-in zoom-in-95 duration-500`} style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: "0.5em" }}>{fill(config.wheel.title_template, { handle: spin.handle })}</div>
            <div className={spin.done ? "overlay-wheel-winner mt-[0.25em]" : "mt-[0.25em]"}>{spin.done ? `🎉 ${spin.text}` : spin.text}</div>
          </div>
        </OverlayBlock>
      )}

      {cta && (
        <OverlayBlock position={config.layout.cta} blockKey="cta">
          <div className={`${panel} font-extrabold animate-in fade-in zoom-in-95 duration-500`}>
            {cta}
          </div>
        </OverlayBlock>
      )}
    </div>
    </div>
  );
}
