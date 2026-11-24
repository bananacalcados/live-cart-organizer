import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hiddenByConflict, measureBlocks } from "@/lib/overlayConflicts";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { OverlayConfig, PaymentTimer, expiredAlertTemplate, fill, formatTimer, normalizeReloadNonce, shouldReloadOverlayForNonce, shouldShowCurrentShownProduct, takeNextTimer, timerShowSeconds, timerStillValid, withOverlayDefaults, overlayEventChanged } from "@/lib/liveOverlay";
import { OverlayBlock } from "@/components/events/OverlayBlock";
import { OverlayPanel } from "@/components/events/OverlayPanel";

interface OvEvent { id: number; kind: string; payload: any; created_at: string }
interface ShownItem { code: string; product_name?: string; color?: string; sale_price?: number; offer_price?: number | null; free_shipping?: boolean; interest_free_installments?: number | null; shown_at?: string; source?: string | null }
interface ShownData { show_codes: boolean; current: ShownItem | null; previous: ShownItem[] }
const brl = (v?: number) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
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
  const reloadNonce = useRef<number | null>(null);
  const reloadNonceSeen = useRef(false);
  const overlayBusy = useRef(true);
  // Relógios: fila (um por vez). currentTimer é o único na tela.
  const timerQueue = useRef<PaymentTimer[]>([]);
  const [currentTimer, setCurrentTimer] = useState<PaymentTimer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  overlayBusy.current = Boolean(alert || currentTimer || spin || raffleWinner || cta);
  // Produto em exibição: só via overlay_shown_products (respeita minutos e is_current).
  const [shown, setShown] = useState<ShownData | null>(null);
  const shownBusy = useRef(false);
  const loadShown = useRef<() => void>(() => {});
  loadShown.current = async () => {
    if (!token || shownBusy.current) return;
    shownBusy.current = true;
    try {
      const { data } = await supabase.rpc("overlay_shown_products" as any, { p_token: token });
      const d = data as any;
      setShown((prev) => {
        const next: ShownData | null = d && !d.error ? { show_codes: !!d.show_codes, current: d.current || null, previous: (d.previous || []).slice(0, 8) } : null;
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    } finally { shownBusy.current = false; }
  };
  useEffect(() => {
    if (!token) return;
    loadShown.current();
    const t = window.setInterval(() => { if (!document.hidden) loadShown.current(); }, 60_000);
    return () => window.clearInterval(t);
  }, [token]);

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

  // Detecta publicação nova sem consultar o banco. Só recarrega com a tela livre.
  useEffect(() => {
    const mainScript = (root: Document) => Array.from(root.scripts)
      .map((script) => script.getAttribute("src") || "")
      .find((src) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(src));
    const loadedScript = mainScript(document);
    if (!loadedScript) return;
    let stopped = false;
    const checkVersion = async () => {
      if (stopped || document.hidden || overlayBusy.current) return;
      try {
        const response = await fetch("/", { cache: "no-store" });
        if (!response.ok) return;
        const html = await response.text();
        const publishedScript = mainScript(new DOMParser().parseFromString(html, "text/html"));
        if (!stopped && publishedScript && publishedScript !== loadedScript && !overlayBusy.current) window.location.reload();
      } catch { /* Uma falha de rede não interfere na live; tenta novamente em 5 min. */ }
    };
    const interval = window.setInterval(checkVersion, 5 * 60_000);
    return () => { stopped = true; window.clearInterval(interval); };
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
        loadShown.current();
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
        const incomingNonce = normalizeReloadNonce(c.reload_nonce);
        if (shouldReloadOverlayForNonce(reloadNonce.current, incomingNonce, reloadNonceSeen.current)) {
          window.location.reload();
          return;
        }
        reloadNonce.current = incomingNonce;
        reloadNonceSeen.current = true;
        cfgRef.current = c;
        setConfig(c);
      }
      setHidden(!!d.settings?.hidden);
      setRaffleCount((v) => (v === d.raffle_count ? v : d.raffle_count || 0));
      if (lastId.current === 0) lastId.current = d.last_id || 0;
      const cfg = cfgRef.current;
      for (const e of (d.events || []) as OvEvent[]) {
        lastId.current = Math.max(lastId.current, e.id);
        if (e.kind === "product_shown") { loadShown.current(); continue; }
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

  // Prioridade por sobreposição: só o bloco de maior prioridade aparece onde dois se cruzam.
  const stageRef = useRef<HTMLDivElement>(null);
  const applyConflicts = useRef(() => {});
  applyConflicts.current = () => {
    const blocks = measureBlocks(stageRef.current);
    const hide = hiddenByConflict(blocks);
    for (const b of blocks) {
      const h = hide.has(b.key);
      b.el.style.transition = "opacity 300ms ease";
      b.el.style.opacity = h ? "0" : "1";
      b.el.style.visibility = h ? "hidden" : "visible";
    }
  };
  useLayoutEffect(() => { applyConflicts.current(); });
  useEffect(() => {
    const t = window.setInterval(() => applyConflicts.current(), 500);
    return () => window.clearInterval(t);
  }, []);

  if (!config) return null;
  const rb = config.raffle_bar;
  const remaining = Math.max(0, (rb.goal_count || 0) - raffleCount);
  const pct = rb.goal_count > 0 ? Math.min(100, (raffleCount / rb.goal_count) * 100) : 0;
  const tickerText = tickerItems.length ? tickerItems[tickerIdx % tickerItems.length].text : "";

  const scale = Math.min(viewport.width / 1080, viewport.height / 1920);
  const offset = (viewport.width - 1080 * scale) / 2;

  return (
    <div className="fixed inset-0 overflow-hidden">
    <div
      ref={stageRef}
      className="absolute top-0 overflow-hidden font-sans"
      style={{ width: 1080, height: 1920, left: offset, transform: `scale(${scale})`, transformOrigin: "top left", background: "transparent", opacity: hidden ? 0 : 1, transition: "opacity 600ms ease" }}
    >
      {config.ticker.enabled && tickerText && (
        <OverlayBlock position={config.layout.ticker} blockKey="ticker">
          <OverlayPanel key={tickerIdx} blockKey="ticker" styles={config.styles} align={config.layout.ticker.align} className="animate-in fade-in duration-700">
            {tickerText}
          </OverlayPanel>
        </OverlayBlock>
      )}

      {rb.enabled && (
        <OverlayBlock position={config.layout.raffle_bar} blockKey="raffle_bar">
          <OverlayPanel blockKey="raffle_bar" styles={config.styles} align={config.layout.raffle_bar.align} className="w-full">
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
          </OverlayPanel>
        </OverlayBlock>
      )}

      {alert && (
        <OverlayBlock position={config.layout.alert} blockKey="alert">
          <OverlayPanel key={alert.key} blockKey="alert" styles={config.styles} align={config.layout.alert.align} expired={alert.tone === "expired"} className="animate-in slide-in-from-left fade-in duration-500" style={{ lineHeight: 1.2 }}>
            {alert.text}
          </OverlayPanel>
        </OverlayBlock>
      )}

      {config.payment_timers.enabled && currentTimer && (
        <OverlayBlock position={config.layout.timers} blockKey="timers">
          <div className="flex flex-col gap-[0.3em]">
            {[currentTimer].map((t) => (
              <OverlayPanel key={t.orderId} blockKey="timers" styles={config.styles} align={config.layout.timers.align} data-overlay-timer={t.orderId} className="animate-in fade-in duration-500" style={{ lineHeight: 1.2 }}>
                {fill(config.payment_timers.template, { handle: t.handle, product: t.product, size: t.size, timer: formatTimer(t.expiresAt - now) })
                  .split(formatTimer(t.expiresAt - now)).flatMap((part, i, arr) => i < arr.length - 1 ? [part, <span key={i} className="overlay-timer">{formatTimer(t.expiresAt - now)}</span>] : [part])}
              </OverlayPanel>
            ))}
          </div>
        </OverlayBlock>
      )}

      {spin && (
        <OverlayBlock position={config.layout.wheel} blockKey="wheel">
          <OverlayPanel key={spin.key} blockKey="wheel" styles={config.styles} align={config.layout.wheel.align} className="relative animate-in fade-in zoom-in-95 duration-500" style={{ lineHeight: 1.2 }}>
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
          </OverlayPanel>
        </OverlayBlock>
      )}

      {config.shown_product.enabled && shown && (shouldShowCurrentShownProduct(shown.show_codes, shown.current) || (shown.show_codes && shown.previous.length > 0)) && (
        <OverlayBlock position={config.layout.shown_product} blockKey="shown_product">
          <div className="flex flex-col gap-[0.25em]">
            {shouldShowCurrentShownProduct(shown.show_codes, shown.current) && shown.current && (
              <OverlayPanel key={shown.current.code + (shown.current.shown_at || "")} blockKey="shown_product" styles={config.styles} align={config.layout.shown_product.align} className="animate-in fade-in zoom-in-95 duration-500" style={{ lineHeight: 1.1 }}>
                <div className="font-black tracking-wide" style={{ fontSize: "2.2em", whiteSpace: "nowrap" }}>{shown.current.code}</div>
                <div className="font-bold" style={{ fontSize: "0.6em" }}>{shown.current.product_name}</div>
                {shown.current.color && <div style={{ fontSize: "0.5em" }}>{shown.current.color}</div>}
                {shown.current.offer_price != null ? (
                  <div className="mt-[0.15em]">
                    <div className="font-bold line-through opacity-80" style={{ fontSize: "0.42em" }}>De {brl(shown.current.sale_price)}</div>
                    <div className="font-extrabold" style={{ fontSize: "0.75em" }}>Por {brl(shown.current.offer_price)}</div>
                  </div>
                ) : shown.current.sale_price != null && <div className="font-extrabold mt-[0.15em]" style={{ fontSize: "0.75em" }}>{brl(shown.current.sale_price)}</div>}
                {!!shown.current.interest_free_installments && <div className="font-bold" style={{ fontSize: "0.42em" }}>em até {shown.current.interest_free_installments}x sem juros</div>}
                {shown.current.free_shipping && <div className="font-extrabold" style={{ fontSize: "0.48em" }}>FRETE GRÁTIS</div>}
              </OverlayPanel>
            )}
            {shown.show_codes && shown.previous.filter((p) => p.code !== shown.current?.code).slice(0, 8).map((p) => (
              <OverlayPanel key={p.code} blockKey="shown_product" styles={config.styles} align={config.layout.shown_product.align} className="animate-in fade-in duration-500" style={{ fontWeight: 700, fontSize: "0.42em", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {p.code} · {(p.product_name || "").split(" ").slice(0, 3).join(" ")}{p.color ? ` · ${p.color}` : ""}
              </OverlayPanel>
            ))}
          </div>
        </OverlayBlock>
      )}

      {cta && (
        <OverlayBlock position={config.layout.cta} blockKey="cta">
          <OverlayPanel blockKey="cta" styles={config.styles} align={config.layout.cta.align} className="animate-in fade-in zoom-in-95 duration-500">
            {cta}
          </OverlayPanel>
        </OverlayBlock>
      )}
    </div>
    </div>
  );
}
