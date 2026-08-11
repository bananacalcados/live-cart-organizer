import { useEffect, useMemo, useRef, useState } from "react";
import tenisAsset from "@/assets/conforto-tenis.webp.asset.json";
import sandaliaAsset from "@/assets/conforto-sandalia.webp.asset.json";

const LAUNCH_MS = new Date("2026-08-14T09:00:00-03:00").getTime();

const STORES = [
  {
    name: "Loja Centro",
    address: "Rua Afonso Pena, 3473, Centro",
    maps: "https://www.google.com/maps/search/?api=1&query=Rua+Afonso+Pena+3473+Centro+Governador+Valadares+MG",
  },
  {
    name: "Loja Pérola",
    address: "Rua Vale Formoso, 362, Jardim Pérola",
    maps: "https://www.google.com/maps/search/?api=1&query=Rua+Vale+Formoso+362+Jardim+Perola+Governador+Valadares+MG",
  },
];

function useCountdown(target: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target - now);
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    finished: diff === 0,
  };
}

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`cf-reveal ${visible ? "is-visible" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function maskPhone(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const Cloud = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg className={className} style={style} viewBox="0 0 220 80" fill="none" aria-hidden="true">
    <path
      d="M40 68c-16 0-28-10-28-23S24 22 40 23c4-13 17-22 32-22 17 0 31 11 34 26 3-2 7-3 11-3 12 0 21 9 21 20 0 1 0 3-1 4 12 1 21 10 21 21H40z"
      fill="currentColor"
    />
  </svg>
);

const Feather = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20.2 3.8c-3-3-9 .3-12.6 3.9-2.9 2.9-3.4 6.8-2.5 9.7L2 20.5l1.4 1.4 3.1-3.1c2.9.9 6.8.4 9.7-2.5 3.6-3.6 6.9-9.6 4-12.5Z" stroke="currentColor" strokeWidth="1.2" />
    <path d="M14.5 9.5 6.6 17.4" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const Pin = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
    <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export default function ConfortoLP() {
  const c = useCountdown(LAUNCH_MS);
  const [form, setForm] = useState({ name: "", phone: "" });

  useEffect(() => {
    document.title = "Coleção Conforto | Banana Calçados";
    const setMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setMeta("description", "Banana veste Conforto: a nova Coleção Conforto chega em 14/08. Leveza que você sente no primeiro passo. Cadastre-se e concorra a um tênis.");

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap";
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, []);

  const countdownBoxes = useMemo(
    () => [
      { v: c.days, l: "dias" },
      { v: c.hours, l: "horas" },
      { v: c.minutes, l: "min" },
      { v: c.seconds, l: "seg" },
    ],
    [c]
  );

  const scrollToForm = () => {
    document.getElementById("cadastro")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="cf-root">
      <style>{CSS}</style>

      {/* Sky background with drifting clouds */}
      <div className="cf-sky" aria-hidden="true">
        <Cloud className="cf-cloud cf-cloud-1" />
        <Cloud className="cf-cloud cf-cloud-2" />
        <Cloud className="cf-cloud cf-cloud-3" />
        <Feather className="cf-feather cf-feather-1" />
        <Feather className="cf-feather cf-feather-2" />
      </div>

      {/* HERO */}
      <header className="cf-hero">
        <span className="cf-eyebrow">Banana Confort · Lançamento 14/08</span>
        <h1 className="cf-h1"><span className="cf-brand">Banana</span> veste Conforto</h1>
        <p className="cf-sub">A nova Coleção Conforto chegou — leveza que você sente no primeiro passo.</p>

        <div className="cf-count" role="timer" aria-label="Contagem regressiva para o lançamento">
          {countdownBoxes.map((b) => (
            <div className="cf-count-box" key={b.l}>
              <strong>{String(b.v).padStart(2, "0")}</strong>
              <span>{b.l}</span>
            </div>
          ))}
        </div>

        <div className="cf-hero-img">
          <div className="cf-shadow" aria-hidden="true" />
          <img
            src={tenisAsset.url}
            alt="Tênis caramelo em tecido knit da Coleção Conforto Banana Calçados"
            width={720}
            height={720}
            loading="eager"
            decoding="async"
            className="cf-bob"
          />
        </div>

        <button type="button" className="cf-cta" onClick={scrollToForm}>Quero participar</button>
      </header>

      {/* A COLEÇÃO */}
      <section className="cf-section">
        <Reveal>
          <h2 className="cf-h2">A Coleção</h2>
          <p className="cf-lead">Três famílias pensadas para o dia inteiro em pé — palmilha macia, solado leve e acabamento delicado.</p>
        </Reveal>

        <div className="cf-cards">
          {["Tênis", "Sandálias", "Tamancos"].map((t, i) => (
            <Reveal key={t} delay={i * 90}>
              <article className={`cf-card cf-card-${i + 1}`}>
                <span className="cf-card-num">0{i + 1}</span>
                <h3>{t}</h3>
                <p>{i === 0 ? "Knit respirável que abraça o pé." : i === 1 ? "Tiras suaves e apoio no calcanhar." : "Estabilidade com toque acolchoado."}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={80}>
          <figure className="cf-figure">
            <img
              src={sandaliaAsset.url}
              alt="Detalhe da sandália preta com palmilha nude acolchoada e monograma dourado"
              width={960}
              height={960}
              loading="lazy"
              decoding="async"
            />
            <figcaption>Palmilha acolchoada · alívio a cada passo</figcaption>
          </figure>
        </Reveal>
      </section>

      {/* OFERTA */}
      <section className="cf-section cf-offer">
        <Reveal>
          <div className="cf-offer-card">
            <span className="cf-badge">Parcelamento</span>
            <p className="cf-offer-big">Em até <strong>10x</strong> sem juros</p>
            <p className="cf-lead">Em todos os modelos da Coleção Conforto, nas duas lojas.</p>
          </div>
        </Reveal>
      </section>

      {/* SORTEIO */}
      <section className="cf-section">
        <Reveal>
          <div className="cf-raffle">
            <h2 className="cf-h2">Cadastre-se e concorra a um TÊNIS da Coleção Conforto 🎁</h2>
            <p className="cf-lead">Um par sorteado entre os cadastros VIP no dia do lançamento.</p>
          </div>
        </Reveal>
      </section>

      {/* FORMULÁRIO (visual) */}
      <section className="cf-section" id="cadastro">
        <Reveal>
          <form className="cf-form" onSubmit={(e) => e.preventDefault()}>
            <h2 className="cf-h2 cf-h2-sm">Lista VIP</h2>
            <label className="cf-field">
              <span>Nome</span>
              <input
                type="text"
                placeholder="Seu nome completo"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="cf-field">
              <span>Telefone</span>
              <input
                type="tel"
                inputMode="tel"
                placeholder="(33) 99999-9999"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: maskPhone(e.target.value) }))}
              />
            </label>
            <button type="submit" className="cf-cta cf-cta-block">Garantir minha vaga VIP</button>
            <p className="cf-fineprint">Seus dados são usados apenas para avisar sobre o lançamento.</p>
          </form>
        </Reveal>
      </section>

      {/* LOJAS */}
      <section className="cf-section">
        <Reveal>
          <h2 className="cf-h2">Lançamento nas lojas</h2>
          <p className="cf-date">14/08</p>
        </Reveal>
        <div className="cf-stores">
          {STORES.map((s, i) => (
            <Reveal key={s.name} delay={i * 90}>
              <article className={`cf-store cf-store-${i + 1}`}>
                <h3><Pin /> {s.name}</h3>
                <p>{s.address}</p>
                <p className="cf-city">Governador Valadares – MG</p>
                <a href={s.maps} target="_blank" rel="noopener noreferrer" className="cf-map-btn">Ver no mapa</a>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <footer className="cf-footer">
        <p className="cf-logo">Banana<span>Calçados</span></p>
        <nav className="cf-social" aria-label="Redes sociais">
          <a href="https://www.instagram.com/bananacalcadosgv/" target="_blank" rel="noopener noreferrer">Instagram</a>
          <a href="https://wa.me/553399999999" target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </nav>
        <p className="cf-copy">© {new Date().getFullYear()} Banana Calçados · Governador Valadares – MG</p>
      </footer>
    </div>
  );
}

const CSS = `
.cf-root{
  --cf-cream:#FBF6EF; --cf-offwhite:#FFFDFA; --cf-nude:#EADFD1;
  --cf-taupe:#A8968A; --cf-cacau:#5B4436; --cf-ink:#2C231D; --cf-gold:#C9A227;
  position:relative; min-height:100vh; overflow-x:hidden;
  background:linear-gradient(180deg,#F2F6FA 0%, var(--cf-cream) 38%, var(--cf-offwhite) 100%);
  color:var(--cf-ink); font-family:Poppins,ui-sans-serif,system-ui,sans-serif; font-weight:400;
}
.cf-root *{box-sizing:border-box}
.cf-sky{position:absolute;inset:0 0 auto;height:120vh;pointer-events:none;overflow:hidden}
.cf-cloud{position:absolute;color:#fff;opacity:.75;width:220px}
.cf-cloud-1{top:6%;left:-25%;animation:cf-drift 70s linear infinite}
.cf-cloud-2{top:26%;left:-40%;width:150px;opacity:.55;animation:cf-drift 95s linear infinite 6s}
.cf-cloud-3{top:52%;left:-35%;width:280px;opacity:.45;animation:cf-drift 120s linear infinite 12s}
.cf-feather{position:absolute;color:var(--cf-gold);opacity:.35;width:26px}
.cf-feather-1{top:18%;right:8%;animation:cf-float 16s ease-in-out infinite}
.cf-feather-2{top:44%;left:7%;width:20px;animation:cf-float 22s ease-in-out infinite 3s}
@keyframes cf-drift{to{transform:translateX(160vw)}}
@keyframes cf-float{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-18px) rotate(8deg)}}
@keyframes cf-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}

.cf-hero{position:relative;z-index:1;text-align:center;padding:56px 20px 40px;max-width:820px;margin:0 auto}
.cf-eyebrow{display:inline-block;font-size:clamp(1.05rem,3.6vw,1.5rem);font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--cf-cacau);background:rgba(201,162,39,.12);border:2px solid rgba(201,162,39,.45);border-radius:999px;padding:14px 28px;line-height:1.3}
.cf-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(2.9rem,10vw,5.4rem);line-height:1.03;letter-spacing:-.02em;margin:22px 0 16px;color:var(--cf-cacau)}
.cf-brand{background:linear-gradient(135deg,#E0A200,var(--cf-gold) 55%,#B37A12);-webkit-background-clip:text;background-clip:text;color:transparent}
.cf-sub{font-size:clamp(1.18rem,4.2vw,1.55rem);font-weight:400;color:var(--cf-cacau);opacity:.85;max-width:32ch;margin:0 auto;line-height:1.6}
.cf-count{display:flex;flex-wrap:wrap;justify-content:center;gap:16px;margin:30px 0 10px}
.cf-count-box{background:rgba(255,255,255,.78);backdrop-filter:blur(6px);border:2px solid rgba(201,162,39,.35);border-radius:22px;padding:20px 24px;min-width:128px}
.cf-count-box strong{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(3rem,10vw,4rem);line-height:1;color:var(--cf-cacau);font-variant-numeric:tabular-nums}
.cf-count-box span{display:block;margin-top:6px;font-size:clamp(.9rem,2.6vw,1.15rem);font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--cf-taupe)}
.cf-hero-img{position:relative;margin:18px auto 6px;max-width:560px}
.cf-hero-img img{width:100%;height:auto;border-radius:24px;display:block}
.cf-bob{animation:cf-bob 7s ease-in-out infinite}
.cf-shadow{position:absolute;bottom:6px;left:12%;right:12%;height:22px;border-radius:50%;background:radial-gradient(ellipse at center,rgba(91,68,54,.22),transparent 70%);filter:blur(3px)}
.cf-cta{margin-top:26px;display:inline-block;border:0;cursor:pointer;background:linear-gradient(135deg,var(--cf-cacau),#3E2E24);color:#FFF8E9;font-family:Poppins,sans-serif;font-weight:700;font-size:clamp(1.5rem,4.4vw,2.1rem);letter-spacing:.02em;padding:32px 74px;border-radius:999px;box-shadow:0 12px 28px -12px rgba(91,68,54,.6);transition:transform .25s ease,box-shadow .25s ease}
.cf-cta:hover{transform:translateY(-2px);box-shadow:0 18px 34px -14px rgba(91,68,54,.7)}
.cf-cta-block{width:100%;margin-top:14px;padding:34px 40px}

.cf-section{position:relative;z-index:1;max-width:1040px;margin:0 auto;padding:26px 20px}
.cf-h2{font-family:Poppins,sans-serif;font-weight:700;letter-spacing:-.01em;font-size:clamp(2.1rem,7vw,3.3rem);color:var(--cf-cacau);text-align:center;margin:0 0 12px;line-height:1.2}
.cf-h2-sm{font-size:clamp(2.4rem,7vw,3.4rem)}
.cf-lead{text-align:center;color:var(--cf-cacau);opacity:.9;max-width:34ch;margin:0 auto;line-height:1.5;font-size:clamp(1.5rem,5vw,2.1rem);font-weight:500}
.cf-cards{display:grid;gap:18px;margin-top:36px}
.cf-card{background:var(--cf-offwhite);border:2px solid var(--cf-nude);border-radius:26px;padding:40px 30px;box-shadow:0 14px 34px -26px rgba(91,68,54,.5);transition:transform .3s ease,box-shadow .3s ease,border-color .3s ease;height:100%}
.cf-card:hover{transform:translateY(-6px);border-color:rgba(201,162,39,.5);box-shadow:0 18px 40px -22px rgba(91,68,54,.5)}
.cf-card-num{display:inline-block;font-size:13px;font-weight:700;letter-spacing:.18em;color:#fff;background:var(--cf-gold);border-radius:999px;padding:5px 12px}
.cf-card-1{background:linear-gradient(165deg,#FFF7E6,#FBE9C8);border-color:rgba(201,162,39,.45)}
.cf-card-1 .cf-card-num{background:#C9A227}
.cf-card-2{background:linear-gradient(165deg,#FDF1EA,#F6DCCB);border-color:rgba(197,124,84,.45)}
.cf-card-2 .cf-card-num{background:#C57C54}
.cf-card-3{background:linear-gradient(165deg,#EEF6F1,#D8EADF);border-color:rgba(90,142,113,.45)}
.cf-card-3 .cf-card-num{background:#5A8E71}
.cf-card h3{font-family:Poppins,sans-serif;font-size:clamp(1.7rem,5vw,2.1rem);margin:14px 0 10px;color:var(--cf-cacau);font-weight:700;letter-spacing:-.01em}
.cf-card p{color:var(--cf-cacau);opacity:.8;font-size:clamp(1.02rem,3.4vw,1.15rem);line-height:1.6;margin:0}
.cf-figure{margin:34px 0 0;text-align:center}
.cf-figure img{width:100%;max-width:720px;height:auto;border-radius:26px;display:block;margin:0 auto}
.cf-figure figcaption{margin-top:18px;font-size:clamp(1.25rem,4vw,1.7rem);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--cf-cacau)}

.cf-offer-card{text-align:center;background:linear-gradient(160deg,#FFFDF8,#F3E9DC);border:1px solid rgba(201,162,39,.35);border-radius:28px;padding:44px 24px}
.cf-badge{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:#FFF8E9;background:var(--cf-gold);border-radius:999px;padding:6px 14px}
.cf-offer-big{font-family:Poppins,sans-serif;font-size:clamp(2.4rem,9vw,4rem);color:var(--cf-cacau);margin:18px 0 12px;font-weight:700;letter-spacing:-.02em}
.cf-offer-big strong{color:var(--cf-gold)}
.cf-raffle{background:var(--cf-offwhite);border:1px dashed rgba(201,162,39,.55);border-radius:24px;padding:40px 22px}

.cf-form{background:var(--cf-offwhite);border:2px solid var(--cf-nude);border-radius:32px;padding:56px 44px;max-width:900px;margin:0 auto;box-shadow:0 24px 50px -34px rgba(91,68,54,.55)}
.cf-field{display:block;margin-bottom:26px}
.cf-field span{display:block;font-size:clamp(1.7rem,5.5vw,2.4rem);font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--cf-cacau);margin-bottom:14px;line-height:1.2}
.cf-field input{width:100%;height:96px;border-radius:20px;border:2px solid var(--cf-nude);background:#fff;padding:0 26px;font-family:Poppins,sans-serif;font-size:clamp(1.5rem,4.6vw,2rem);font-weight:500;color:var(--cf-ink);outline:none;transition:border-color .2s ease,box-shadow .2s ease}
.cf-field input::placeholder{font-size:clamp(1.25rem,3.8vw,1.6rem);color:rgba(168,150,138,.85)}
.cf-field input:focus{border-color:var(--cf-gold);box-shadow:0 0 0 3px rgba(201,162,39,.16)}
.cf-fineprint{text-align:center;font-size:1.05rem;color:var(--cf-taupe);margin:12px 0 0}

.cf-date{font-family:Poppins,sans-serif;font-weight:800;letter-spacing:-.02em;font-size:clamp(3rem,12vw,5rem);text-align:center;color:var(--cf-gold);margin:6px 0 22px;font-weight:700}
.cf-stores{display:grid;gap:20px}
.cf-store{position:relative;background:var(--cf-offwhite);border:3px solid var(--cf-nude);border-radius:28px;padding:38px 30px;height:100%;box-shadow:0 18px 40px -26px rgba(91,68,54,.55);transition:transform .3s ease,box-shadow .3s ease}
.cf-store:hover{transform:translateY(-6px);box-shadow:0 24px 46px -22px rgba(91,68,54,.55)}
.cf-store-1{background:linear-gradient(160deg,#FFF6DF,#F7DFA8);border-color:rgba(201,162,39,.6)}
.cf-store-2{background:linear-gradient(160deg,#FDEDE4,#F4CDB4);border-color:rgba(197,124,84,.6)}
.cf-store h3{display:flex;align-items:center;gap:12px;font-family:Poppins,sans-serif;font-size:clamp(1.9rem,6vw,2.5rem);color:var(--cf-cacau);margin:0 0 12px;font-weight:800;letter-spacing:-.01em}
.cf-store h3 svg{width:28px;height:28px;flex:none}
.cf-store p{margin:0;color:var(--cf-cacau);opacity:.92;font-size:clamp(1.25rem,4vw,1.5rem);line-height:1.5;font-weight:500}
.cf-city{font-size:clamp(1.05rem,3.4vw,1.25rem) !important;opacity:.75}
.cf-map-btn{display:inline-block;margin-top:20px;border:0;background:var(--cf-cacau);color:#FFF8E9;text-decoration:none;border-radius:999px;padding:18px 36px;font-size:clamp(1.1rem,3.4vw,1.3rem);font-weight:700;transition:transform .25s ease,box-shadow .25s ease}
.cf-map-btn:hover{transform:translateY(-2px);box-shadow:0 14px 28px -14px rgba(91,68,54,.7)}

.cf-footer{position:relative;z-index:1;text-align:center;padding:48px 20px 60px;border-top:1px solid var(--cf-nude);margin-top:20px}
.cf-logo{font-family:Poppins,sans-serif;font-weight:700;font-size:1.8rem;color:var(--cf-cacau);margin:0}
.cf-logo span{color:var(--cf-gold);margin-left:6px}
.cf-social{display:flex;gap:20px;justify-content:center;margin:14px 0}
.cf-social a{color:var(--cf-taupe);text-decoration:none;font-size:1.05rem;font-weight:500;border-bottom:1px solid transparent;transition:color .2s ease,border-color .2s ease}
.cf-social a:hover{color:var(--cf-cacau);border-color:var(--cf-gold)}
.cf-copy{font-size:.9rem;color:var(--cf-taupe);margin:8px 0 0}

.cf-reveal{opacity:0;transform:translateY(24px);transition:opacity .7s ease,transform .7s ease}
.cf-reveal.is-visible{opacity:1;transform:none}

@media (min-width:768px){
  .cf-hero{padding:70px 24px 30px}
  .cf-section{padding:36px 24px}
  .cf-cards{grid-template-columns:repeat(3,1fr);gap:18px}
  .cf-stores{grid-template-columns:repeat(2,1fr);gap:18px}
  .cf-count-box{min-width:150px;padding:24px 28px}
}
@media (prefers-reduced-motion: reduce){
  .cf-root *{animation:none !important;transition:none !important}
  .cf-reveal{opacity:1;transform:none}
}
`;
