import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { OverlayConfig, PaymentTimer, expiredAlertTemplate, fill, formatTimer, takeNextTimer, timerShowSeconds, timerStillValid, withOverlayDefaults, overlayEventChanged } from "@/lib/liveOverlay";
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
  const [spin, setSpin] = useState<{ key: number; handle: string; text: string; done: boolean; raffle?: boolean; prize?: string } | null>(null);
  const spinQueue = useRef<{ key: number; handle: string; labels: string[]; winner: string; raffle?: boolean; prize?: string }[]>([]);
  const [raffleWinner, setRaffleWinner] = useState<{ key: number; label: string } | null>(null);
  const spinBusy = useRef(false);
  const lastId = useRef(0);
  const liveId = useRef<string | null>(null);
  const liveGeneration = useRef(0);
  const queue = useRef<Alert[]>([]);
  const ctaIdx = useRef(0);
  const ctaTimer = useRef<number | null>(null);
  const cfgRef = useRef<OverlayConfig | null>(null);
  const cfgKey = useRef("");
  // Relógios: fila (um por vez). currentTimer é o único na tela.
  const timerQueue = useRef<PaymentTimer[]>([]);
  const [currentTimer, setCurrentTimer] = useState<PaymentTimer | null>(null);
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
    const generation = liveGeneration.current;
    const labels = s.labels.length ? s.labels : [s.winner];
    let i = 0; let delay = 70; let elapsed = 0;
    const step = () => {
      if (generation !== liveGeneration.current) return;
      if (elapsed >= 6000) {
        setSpin({ key: s.key, handle: s.handle, text: s.winner, done: true, raffle: s.raffle, prize: s.prize });
        if (s.raffle) {
          // Sorteio: ganhadora fica em destaque 10 s e a barra vira "Ganhadora: @x".
          setRaffleWinner({ key: s.key, label: s.winner });
          window.setTimeout(() => { if (generation === liveGeneration.current) setRaffleWinner((w) => (w && w.key === s.key ? null : w)); }, 30_000);
        }
        const secs = s.raffle ? 10 : Math.max(3, cfgRef.current?.wheel.result_seconds || 8);
        window.setTimeout(() => { if (generation !== liveGeneration.current) return; setSpin(null); spinBusy.current = false; runSpin(); }, secs * 1000);
        return;
      }
      setSpin({ key: s.key, handle: s.handle, text: labels[i % labels.length], done: false, raffle: s.raffle, prize: s.prize });
      i += 1; elapsed += delay; delay = Math.min(450, delay * 1.08);
      window.setTimeout(step, delay);
    };
    step();
  };

  // Polling
  useEffect(() => {
    if (!token) return;
    let stop = false;
    let pulling = false;
    const pull = async () => {
      if (pulling || document.hidden) return;
      pulling = true;
      let data: any;
      try {
        const result = await supabase.rpc("overlay_pull" as any, { p_token: token, p_after_id: lastId.current });
        data = result.data;
      } finally { pulling = false; }
      if (stop || !data || (data as any).error) return;
      const d = data as any;
      if (overlayEventChanged(liveId.current, d.event_id || null)) {
        liveId.current = d.event_id;
        liveGeneration.current += 1;
        lastId.current = 0;
        queue.current = [];
        timerQueue.current = [];
        spinQueue.current = [];
        spinBusy.current = false;
        setAlert(null); setCurrentTimer(null); setSpin(null); setRaffleWinner(null); setCta(null);
        setTickerIdx(0); ctaIdx.current = 0;
        if (ctaTimer.current) window.clearTimeout(ctaTimer.current);
        return; // Next pull starts at the latest cursor for this live, skipping its history.
      }
      liveId.current = d.event_id || liveId.current;
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
        if ((e.kind === "paid" || e.kind === "expired") && p.order_id) {
          timerQueue.current = timerQueue.current.filter((t) => t.orderId !== p.order_id);
          setCurrentTimer((c) => (c && c.orderId === p.order_id ? null : c));
        }
        if ((e.kind === "timer" || e.kind === "assembled") && p.expires_at && p.order_id && cfg.payment_timers.enabled) {
          const t: PaymentTimer = { orderId: p.order_id, handle: p.handle || "cliente", product: p.product || "", size: p.size || "", expiresAt: new Date(p.expires_at).getTime(), addedAt: new Date(e.created_at).getTime() };
          // Mesmo pedido já na fila: só atualiza o prazo, mantendo o lugar na fila.
          const idx = timerQueue.current.findIndex((x) => x.orderId === t.orderId);
          if (idx >= 0) timerQueue.current[idx] = t;
          else timerQueue.current.push(t);
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
        } else if (e.kind === "raffle_draw" && cfg.wheel.enabled && e.payload?.winner_label) {
          // Sorteio do painel: mesma roleta, com confete e destaque de 10 s.
          spinQueue.current.push({ key: e.id, handle: e.payload.handle || "cliente", labels: (e.payload.labels || []).filter(Boolean), winner: e.payload.winner_label, raffle: true, prize: e.payload.prize_label || "" });
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

  // Fila de relógios: mostra um por vez, cada um pelo tempo configurado.
  useEffect(() => {
    if (currentTimer) {
      const tick = window.setInterval(() => {
        const n = Date.now();
        setNow(n);
        if (!timerStillValid(currentTimer, n)) setCurrentTimer(null);
      }, 1000);
      const end = window.setTimeout(() => setCurrentTimer(null), timerShowSeconds(cfgRef.current?.payment_timers || { enabled: true, template: "", duration_seconds: 6 }) * 1000);
      return () => { window.clearInterval(tick); window.clearTimeout(end); };
    }
    const t = window.setInterval(() => {
      if (!timerQueue.current.length) return;
      const n = Date.now();
      const { next, rest } = takeNextTimer(timerQueue.current, n);
      timerQueue.current = rest;
      if (next) { setNow(n); setCurrentTimer(next); }
    }, 500);
    return () => window.clearInterval(t);
  }, [currentTimer]);

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
            {raffleWinner
              ? <span className="overlay-wheel-winner">🏆 Ganhadora: {raffleWinner.label}</span>
              : fill(rb.text_template, { count: raffleCount })}
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

      {config.payment_timers.enabled && currentTimer && (
        <OverlayBlock position={config.layout.timers} blockKey="timers">
          <div className="flex flex-col gap-[0.3em]">
            {[currentTimer].map((t) => (
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
          <div key={spin.key} className={`${panel} relative font-extrabold animate-in fade-in zoom-in-95 duration-500`} style={{ lineHeight: 1.2 }}>
            {spin.done && spin.raffle && (
              <div className="overlay-confetti" aria-hidden>
                {Array.from({ length: 28 }).map((_, i) => (
                  <i key={i} style={{
                    left: `${(i * 37) % 100}%`,
                    background: ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#facc15"][i % 6],
                    animationDelay: `${(i % 9) * 0.18}s`,
                  }} />
                ))}
              </div>
            )}
            <div style={{ fontSize: "0.5em" }}>
              {spin.raffle ? `🎁 Sorteio${spin.prize ? ` · ${spin.prize}` : ""}` : fill(config.wheel.title_template, { handle: spin.handle })}
            </div>
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
