import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { captureAttribution, attributionPayload, resolveUtm } from "@/lib/metaAttribution";

/**
 * /zap/:slug — ponte da Live para o WhatsApp.
 * 1) Ao abrir, captura fbc/fbp/UTMs e registra o clique.
 * 2) Pede o WhatsApp da cliente numa tela única (campo + CONFIRMAR).
 * 3) Confirma → grava o telefone no clique, recebe o código e abre o WhatsApp
 *    com a frase pré-preenchida ("Oii, vim da Live, pode me ajudar? #CODIGO").
 */

const PHONE_STORAGE_KEY = "bc_zap_phone";

const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Aceita 10/11 dígitos (com ou sem 55). Injeta o 9º dígito. Retorna 11 dígitos locais ou null. */
function normalizeLocal(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2);
  if (d.length !== 11) return null;
  if (!VALID_DDD.has(Number(d.slice(0, 2)))) return null;
  if (d[2] !== "9") return null;
  if (/^(\d)\1{7}$/.test(d.slice(3))) return null;
  return d;
}

function maskPhone(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

type Status = "loading" | "ask_phone" | "confirming" | "redirecting" | "inapp" | "paused" | "error";

export default function LiveWhatsAppRedirectPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState<Status>("loading");
  const [waUrl, setWaUrl] = useState<string | null>(null);
  const [clickId, setClickId] = useState<string | null>(null);
  const [digits, setDigits] = useState("");
  const [remembered, setRemembered] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const fnUrl = `${supabaseUrl}/functions/v1/live-whatsapp-redirect`;
  const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isInApp = /Instagram|FBAN|FBAV/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  // Passo 1: registra o clique assim que a página abre (fbc/fbp/IP já capturados)
  useEffect(() => {
    if (!slug) {
      setStatus("error");
      return;
    }
    captureAttribution();
    const attr = attributionPayload();

    const rq = new URLSearchParams({ slug });
    if (attr.fbclid) rq.set("fbclid", attr.fbclid);
    if (attr.fbc) rq.set("fbc", attr.fbc);
    if (attr.fbp) rq.set("fbp", attr.fbp);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
      const v = resolveUtm(k);
      if (v) rq.set(k, v);
    }
    try {
      rq.set("ref", window.location.href.slice(0, 500));
    } catch {
      /* ignore */
    }

    try {
      const saved = localStorage.getItem(PHONE_STORAGE_KEY);
      if (saved && normalizeLocal(saved)) {
        setDigits(normalizeLocal(saved)!);
        setRemembered(true);
      }
    } catch {
      /* ignore */
    }

    fetch(`${fnUrl}?${rq.toString()}`, { headers: { apikey } })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error === "paused") {
          setStatus("paused");
          return;
        }
        if (data?.error === "not_found") throw new Error("not_found");
        setClickId(data?.click_id || null);
        setStatus("ask_phone");
      })
      .catch((err) => {
        console.error("[LiveZap] erro:", err);
        setStatus("error");
      });
  }, [slug, fnUrl, apikey]);

  useEffect(() => {
    if (status === "ask_phone" && !remembered) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [status, remembered]);

  const openWhatsApp = (target: string) => {
    setWaUrl(target);
    setStatus("redirecting");
    if (isAndroid && isInApp) {
      const intentUrl = `intent://${target.replace("https://", "")}#Intent;scheme=https;package=com.whatsapp;S.browser_fallback_url=${encodeURIComponent(target)};end`;
      window.location.href = intentUrl;
      return;
    }
    if (isInApp) {
      // iOS dentro do Instagram: webview nem sempre abre o app → botão manual.
      setStatus("inapp");
      return;
    }
    window.location.href = target;
  };

  const confirm = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const local = normalizeLocal(digits);
    if (!local) {
      setFieldError("Confere o número? Precisa ter DDD + 9 dígitos.");
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    setStatus("confirming");
    try {
      localStorage.setItem(PHONE_STORAGE_KEY, local);
    } catch {
      /* ignore */
    }
    try {
      const r = await fetch(fnUrl, {
        method: "POST",
        headers: { apikey, "Content-Type": "application/json" },
        body: JSON.stringify({ click_id: clickId, phone: local }),
      });
      const data = await r.json();
      if (data?.error === "paused") {
        setStatus("paused");
        return;
      }
      if (data?.error === "invalid_phone") {
        setFieldError("Confere o número? Precisa ter DDD + 9 dígitos.");
        setStatus("ask_phone");
        return;
      }
      if (!data?.wa_url) throw new Error(data?.error || "sem link");
      openWhatsApp(data.wa_url as string);
    } catch (err) {
      console.error("[LiveZap] confirm erro:", err);
      setStatus("error");
    }
  };

  const btn: React.CSSProperties = {
    display: "block",
    background: "#25D366",
    color: "white",
    border: "none",
    cursor: "pointer",
    textDecoration: "none",
    padding: "1rem 1.5rem",
    borderRadius: 50,
    fontWeight: 800,
    fontSize: "1.05rem",
    letterSpacing: ".03em",
    width: "100%",
    boxSizing: "border-box",
    boxShadow: "0 6px 18px rgba(0,0,0,.25)",
  };

  return (
    <div
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: "#075e54",
        color: "white",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div style={{ background: "rgba(0,0,0,.25)", borderRadius: 16, padding: "2rem 1.5rem", textAlign: "center", maxWidth: 360, width: "100%" }}>
        {status === "loading" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⏳</div>
            <h2 style={{ margin: 0 }}>Um instante...</h2>
          </>
        )}

        {(status === "ask_phone" || status === "confirming") && (
          <form onSubmit={confirm} noValidate>
            <div style={{ fontSize: "2.2rem", marginBottom: ".5rem" }}>💚</div>
            <h1 style={{ margin: "0 0 1.25rem", fontSize: "1.25rem", lineHeight: 1.3 }}>
              Digite seu WhatsApp pra falar com a gente
            </h1>
            <input
              ref={inputRef}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="(33) 99999-9999"
              value={maskPhone(digits)}
              disabled={status === "confirming"}
              onChange={(e) => {
                setDigits(e.target.value.replace(/\D/g, "").slice(0, 11));
                setRemembered(false);
                if (fieldError) setFieldError(null);
              }}
              aria-label="Seu WhatsApp com DDD"
              aria-invalid={!!fieldError}
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontSize: "1.5rem",
                fontWeight: 700,
                textAlign: "center",
                letterSpacing: ".04em",
                padding: ".9rem 1rem",
                borderRadius: 14,
                border: fieldError ? "2px solid #ffb4a2" : "2px solid transparent",
                outline: "none",
                background: "white",
                color: "#111",
                marginBottom: ".5rem",
              }}
            />
            <div style={{ minHeight: "1.4rem", fontSize: ".85rem", marginBottom: ".75rem" }}>
              {fieldError ? (
                <span style={{ color: "#ffd5cc" }}>{fieldError}</span>
              ) : remembered ? (
                <span style={{ opacity: 0.85 }}>
                  Não é você?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setDigits("");
                      setRemembered(false);
                      setTimeout(() => inputRef.current?.focus(), 30);
                    }}
                    style={{ background: "none", border: "none", color: "white", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}
                  >
                    trocar número
                  </button>
                </span>
              ) : (
                <span style={{ opacity: 0.7 }}>Com DDD, só números.</span>
              )}
            </div>
            <button type="submit" style={{ ...btn, opacity: status === "confirming" ? 0.7 : 1 }} disabled={status === "confirming"}>
              {status === "confirming" ? "ABRINDO..." : "CONFIRMAR"}
            </button>
          </form>
        )}

        {(status === "redirecting" || status === "inapp") && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>💚</div>
            <h2 style={{ margin: "0 0 .5rem" }}>Quase lá!</h2>
            <p style={{ opacity: 0.85, margin: "0 0 1rem", fontSize: ".9rem" }}>
              {status === "inapp"
                ? "Toque no botão abaixo para abrir o WhatsApp e enviar a mensagem."
                : "Se o WhatsApp não abrir sozinho, toque no botão abaixo."}
            </p>
            <a href={waUrl || "#"} style={btn}>
              Abrir WhatsApp
            </a>
          </>
        )}
        {status === "paused" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⏸️</div>
            <h2 style={{ margin: 0 }}>Este link está pausado</h2>
          </>
        )}
        {status === "error" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>😕</div>
            <h2 style={{ margin: 0 }}>Link não encontrado</h2>
          </>
        )}
      </div>
    </div>
  );
}
