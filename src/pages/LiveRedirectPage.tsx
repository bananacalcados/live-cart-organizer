import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

/**
 * Redirecionador universal para a live do Instagram.
 * URL pública: /ao-vivo/:slug (?lead=<phone>&utm_source=<disparo>)
 *
 * - Consulta a edge function `live-redirect` pra descobrir o link ativo do IG.
 * - Aplica deep-link (intent:// Android, instagram:// iOS) pra abrir o app direto.
 * - Se nenhuma live estiver ativa, mostra tela "em breve".
 */
export default function LiveRedirectPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "redirecting" | "offline" | "error">("loading");
  const [targetUrl, setTargetUrl] = useState<string | null>(null);
  const [eventName, setEventName] = useState<string | null>(null);
  const [err, setErr] = useState<string>("");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  useEffect(() => {
    if (!slug) {
      setStatus("error");
      setErr("slug ausente");
      return;
    }

    const qs = new URLSearchParams({ slug });
    const lead = params.get("lead") || params.get("phone");
    const utm = params.get("utm_source");
    if (lead) qs.set("lead", lead);
    if (utm) qs.set("utm_source", utm);

    fetch(`${supabaseUrl}/functions/v1/live-redirect?${qs.toString()}`, {
      headers: { apikey: anon, "Content-Type": "application/json" },
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok && d?.error === "not_found") {
          setStatus("error");
          setErr("Link não encontrado.");
          return;
        }
        if (!d?.is_live || !d?.target_url) {
          setStatus("offline");
          return;
        }

        setTargetUrl(d.target_url);
        setEventName(d.event_name || null);
        setStatus("redirecting");

        const ua = navigator.userAgent || "";
        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPhone|iPad|iPod/i.test(ua);
        const target: string = d.target_url;

        // Extrai o "caminho" pra montar o esquema instagram:// / intent://.
        // Ex.: https://www.instagram.com/username/live/  → username/live/
        let path = target;
        try {
          const u = new URL(target);
          path = u.pathname.replace(/^\//, "") + u.search;
        } catch {}

        if (isAndroid) {
          const fallback = encodeURIComponent(target);
          window.location.href = `intent://${(new URL(target)).host}/${path}#Intent;scheme=https;package=com.instagram.android;S.browser_fallback_url=${fallback};end`;
          return;
        }
        if (isIOS) {
          // Tenta abrir o app; se falhar, cai no https em ~1.2s.
          const tid = setTimeout(() => { window.location.href = target; }, 1200);
          window.location.href = `instagram://media?url=${encodeURIComponent(target)}`;
          window.addEventListener("pagehide", () => clearTimeout(tid), { once: true });
          return;
        }
        window.location.href = target;
      })
      .catch((e) => {
        setStatus("error");
        setErr(String(e?.message || e));
      });
  }, [slug]);

  return (
    <div
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: "linear-gradient(135deg,#833AB4,#FD1D1D,#FCB045)",
        color: "white",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,.30)",
          borderRadius: 16,
          padding: "2rem",
          textAlign: "center",
          maxWidth: 380,
          width: "100%",
        }}
      >
        {status === "loading" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: ".5rem" }}>⏳</div>
            <h2>Carregando…</h2>
          </>
        )}

        {status === "redirecting" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: ".5rem" }}>📸</div>
            <h2 style={{ margin: 0 }}>Estamos AO VIVO!</h2>
            {eventName && <p style={{ opacity: 0.9, marginTop: ".3rem" }}>{eventName}</p>}
            <p style={{ opacity: 0.85, margin: ".8rem 0 1rem", fontSize: ".9rem" }}>
              Abrindo o Instagram…
            </p>
            {targetUrl && (
              <a
                href={targetUrl}
                style={{
                  display: "inline-block",
                  background: "white",
                  color: "#833AB4",
                  textDecoration: "none",
                  padding: ".75rem 1.5rem",
                  borderRadius: 50,
                  fontWeight: 700,
                  width: "100%",
                  maxWidth: 260,
                  boxSizing: "border-box",
                }}
              >
                Abrir Instagram
              </a>
            )}
          </>
        )}

        {status === "offline" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: ".5rem" }}>🕒</div>
            <h2 style={{ margin: 0 }}>Ainda não estamos ao vivo</h2>
            <p style={{ opacity: 0.9, margin: ".8rem 0 0", fontSize: ".95rem" }}>
              Nossa próxima live começa em breve. Volte aqui neste mesmo link quando ela começar!
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: ".5rem" }}>⚠️</div>
            <h2>Link inválido</h2>
            {import.meta.env.DEV && err && (
              <p style={{ fontSize: ".75rem", opacity: 0.6, marginTop: ".5rem" }}>{err}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
