import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type Cenario = { id: string; contexto: string | null; mensagem: string };
type Exp = { onde: string; funcao: string; tempo: string; unidade: "meses" | "anos" };
type Form = {
  nome: string; whatsapp: string; idade: string; bairro: string; cidade: string; transporte: string;
  aceita_condicoes: boolean | null; ja_trabalhou: boolean | null; experiencias: Exp[];
  computador: string; situacao: string; respostas: Record<string, string>; consentimento: boolean;
};
const EMPTY: Form = {
  nome: "", whatsapp: "", idade: "", bairro: "", cidade: "Governador Valadares", transporte: "",
  aceita_condicoes: null, ja_trabalhou: null, experiencias: [], computador: "", situacao: "", respostas: {}, consentimento: false,
};
const MAX_EXP = 10;
const newExp = (): Exp => ({ onde: "", funcao: "", tempo: "", unidade: "meses" });
const TRANSPORTES = [["a_pe", "A pé"], ["onibus", "Ônibus"], ["moto", "Moto"], ["bicicleta", "Bicicleta"], ["carro", "Carro"]] as const;
const COMPUTADOR = [["nunca", "Nunca"], ["um_pouco", "Um pouco"], ["bem", "Bem"]] as const;

function maskPhone(v: string) {
  const d = v.replace(/\D/g, "").replace(/^55(?=\d{11})/, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
const validMobile = (v: string) => /^[1-9][1-9]9\d{8}$/.test(v.replace(/\D/g, ""));

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("rh-public", { body });
  if (error) {
    let payload: any = null;
    try { payload = await (error as any).context?.json?.(); } catch { /* sem corpo */ }
    return { ok: false as const, status: (error as any).context?.status as number | undefined, payload };
  }
  return { ok: true as const, data };
}

const Btn = ({ active, onClick, children, className = "px-4" }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) => (
  <button type="button" onClick={onClick}
    className={`min-h-12 rounded-xl border text-base font-medium transition ${className} ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"}`}>
    {children}
  </button>
);
const Label = ({ children }: { children: React.ReactNode }) => <span className="mb-1.5 block text-sm font-semibold text-foreground">{children}</span>;
const Err = ({ msg }: { msg?: string }) => (msg ? <p className="mt-1 text-sm text-destructive">{msg}</p> : null);
const inputCls = "h-12 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground outline-none focus:ring-2 focus:ring-ring";

const ICONES_APOIO = ["📅", "⏰", "📌"];

// Divide o resumo da vaga (separado por "·") em salário em destaque + linhas de apoio.
function parseResumo(resumo: string) {
  const itens = resumo.split("·").map((s) => s.trim()).filter(Boolean);
  const primeiro = itens[0] || "";
  const m = primeiro.match(/^(R\$\s*[\d.]+(?:,\d{2})?)(.*)$/i);
  const salario = m
    ? { valor: m[1].replace(/\s+/g, " ").trim(), resto: m[2].replace(/^[\s·,;–-]+/, "").trim() }
    : null;
  return { salario, apoio: salario ? itens.slice(1) : itens };
}

const Cap = ({ t }: { t: string }) => <>{t.charAt(0).toUpperCase() + t.slice(1)}</>;

const ResumoCard = ({ resumo }: { resumo: string }) => {
  const { salario, apoio } = parseResumo(resumo);
  if (!salario && apoio.length === 0) return null;
  return (
    <div className="min-w-0 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-primary">Condições da vaga</p>
      {salario && (
        <div className="mt-1 min-w-0">
          <p className="break-words text-3xl font-extrabold leading-tight text-foreground">💰 {salario.valor}</p>
          {salario.resto && <p className="mt-0.5 break-words text-base font-bold text-foreground">{salario.resto}</p>}
        </div>
      )}
      {apoio.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-primary/20 pt-3">
          {apoio.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-base font-semibold text-foreground">
              <span aria-hidden className="shrink-0">{ICONES_APOIO[Math.min(i, ICONES_APOIO.length - 1)]}</span>
              <span className="min-w-0 break-words"><Cap t={t} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default function VagaPublicPage() {
  const { codigo = "" } = useParams();
  const code = codigo.trim().toLowerCase();
  const [state, setState] = useState<"loading" | "form" | "submitted" | "done" | "notfound" | "error" | "limited">("loading");
  const [info, setInfo] = useState<{ username: string; resumo: string; titulo: string; guia: string; cenarios: Cenario[] } | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const lastSaved = useRef<string>("");
  const loaded = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await call({ action: "open", code });
      if (!alive) return;
      if (!r.ok) { setState(r.status === 404 ? "notfound" : r.status === 429 ? "limited" : "error"); return; }
      const d: any = r.data;
      if (d.submitted) { setInfo({ username: d.username, resumo: "", titulo: "", guia: "", cenarios: [] }); setState("submitted"); return; }
      setInfo({ username: d.username, resumo: d.vaga?.resumo || "", titulo: d.vaga?.titulo || "", guia: d.guia || "", cenarios: d.cenarios || [] });
      if (d.draft && typeof d.draft === "object") {
        const merged = { ...EMPTY, ...d.draft, consentimento: false } as Form;
        lastSaved.current = JSON.stringify(merged);
        setForm(merged);
      } else lastSaved.current = JSON.stringify(EMPTY);
      loaded.current = true;
      setState("form");
    })();
    return () => { alive = false; };
  }, [code]);

  // Rascunho no servidor: 6 s depois de parar de digitar (ou ao sair do campo), só se mudou.
  // 429 no rascunho: silêncio e nova tentativa depois de 60 s.
  const formRef = useRef(form); formRef.current = form;
  const retryAt = useRef(0);
  const saving = useRef(false);
  const saveDraft = useCallback(async () => {
    if (!loaded.current || saving.current) return;
    const snap = JSON.stringify(formRef.current);
    if (snap === lastSaved.current) return;
    if (Date.now() < retryAt.current) return;
    saving.current = true;
    try {
      const r = await call({ action: "draft", code, draft: formRef.current });
      if (r.ok) { lastSaved.current = snap; if ((r.data as any)?.submitted) setState("submitted"); }
      else if (r.status === 429) { retryAt.current = Date.now() + 60_000; setTimeout(() => { void saveDraftRef.current(); }, 60_500); }
    } catch { /* silêncio */ } finally { saving.current = false; }
  }, [code]);
  const saveDraftRef = useRef(saveDraft); saveDraftRef.current = saveDraft;
  useEffect(() => {
    if (!loaded.current || state !== "form") return;
    if (JSON.stringify(form) === lastSaved.current) return;
    const t = setTimeout(() => { void saveDraft(); }, 6000);
    return () => clearTimeout(t);
  }, [form, state, saveDraft]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setExp = (i: number, patch: Partial<Exp>) => setForm((f) => ({ ...f, experiencias: f.experiencias.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const idadeNum = Number(form.idade);
  const menor = form.idade !== "" && Number.isInteger(idadeNum) && idadeNum > 0 && idadeNum < 18;

  const progress = useMemo(() => {
    const steps = [
      form.nome.trim().length > 2 && validMobile(form.whatsapp) && idadeNum >= 18 && form.bairro.trim() && form.cidade.trim() && form.transporte,
      form.aceita_condicoes !== null,
      form.ja_trabalhou === false || (form.ja_trabalhou === true && form.experiencias.length > 0),
      !!form.computador,
      form.situacao.trim().length >= 15,
      (info?.cenarios || []).every((c) => (form.respostas[c.id] || "").trim()),
    ];
    return Math.round((steps.filter(Boolean).length / steps.length) * 100);
  }, [form, idadeNum, info]);

  function clientErrors() {
    const e: Record<string, string> = {};
    if (form.nome.trim().length < 3 || !/\s/.test(form.nome.trim())) e.nome = "Informe o nome completo.";
    if (!validMobile(form.whatsapp)) e.whatsapp = "WhatsApp inválido (DDD + 9 + número).";
    if (!Number.isInteger(idadeNum) || idadeNum < 18) e.idade = "Informe sua idade.";
    if (form.bairro.trim().length < 2) e.bairro = "Informe seu bairro.";
    if (form.cidade.trim().length < 2) e.cidade = "Informe sua cidade.";
    if (!form.transporte) e.transporte = "Escolha como vem para o trabalho.";
    if (form.aceita_condicoes === null) e.aceita_condicoes = "Responda sim ou não.";
    if (form.ja_trabalhou === null) e.ja_trabalhou = "Responda sim ou não.";
    if (form.ja_trabalhou) {
      if (!form.experiencias.length) e.experiencias = "Adicione pelo menos uma experiência.";
      form.experiencias.forEach((x, i) => { if (!x.onde.trim() || !x.funcao.trim() || !(Number(x.tempo) > 0)) e[`experiencias.${i}`] = "Preencha onde, o que fazia e quanto tempo."; });
    }
    if (!form.computador) e.computador = "Escolha uma opção.";
    if (form.situacao.trim().length < 15) e.situacao = "Conte a situação em 2 ou 3 frases.";
    (info?.cenarios || []).forEach((c) => { if (!(form.respostas[c.id] || "").trim()) e[`respostas.${c.id}`] = "Responda a mensagem do cliente."; });
    if (!form.consentimento) e.consentimento = "É preciso autorizar o uso dos dados.";
    return e;
  }

  function focusFirst(e: Record<string, string>) {
    const k = Object.keys(e)[0];
    if (k) document.querySelector(`[data-field="${k}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function submit() {
    if (menor) return;
    const e = clientErrors();
    setErrors(e);
    if (Object.keys(e).length) { focusFirst(e); return; }
    setSending(true);
    const payload = { ...form, idade: idadeNum, whatsapp: form.whatsapp.replace(/\D/g, ""),
      experiencias: form.ja_trabalhou ? form.experiencias.map((x) => ({ ...x, tempo: Number(x.tempo) })) : [] };
    const r = await call({ action: "submit", code, data: payload });
    setSending(false);
    if (r.ok) { setState("done"); window.scrollTo(0, 0); return; }
    if (r.status === 409) { setState("submitted"); return; }
    if (r.status === 429) { setErrors({ geral: "Estamos com muitos acessos. Seus dados estão salvos nesta tela, toque em Enviar de novo em 1 minuto." }); return; }
    if (r.payload?.fields) { setErrors(r.payload.fields); focusFirst(r.payload.fields); return; }
    setErrors({ geral: "Não conseguimos enviar agora. Confira sua internet e tente de novo." });
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground" onBlurCapture={() => { if (state === "form") void saveDraftRef.current(); }}><div className="mx-auto max-w-md px-4 py-6">{children}</div></div>
  );
  const centered = (title: string, text?: string) => shell(
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>{text && <p className="text-muted-foreground">{text}</p>}
    </div>,
  );

  if (state === "loading") return centered("Carregando…");
  if (state === "notfound") return centered("Link não encontrado", "Confira se o link está completo.");
  if (state === "limited") return centered("Estamos com muitos acessos", "Espere 1 minutinho e abra o link de novo.");
  if (state === "error") return centered("Não conseguimos abrir", "Confira sua internet e tente de novo.");
  if (state === "submitted") return centered("Você já enviou seu cadastro. Obrigado!");
  if (state === "done") return centered("Recebemos!", "Se você for selecionado(a), chamamos pelo WhatsApp ou Instagram.");
  if (!info) return null;

  const nuncaTrabalhou = form.ja_trabalhou === false;
  return shell(
    <div className="space-y-6 pb-24">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Cadastro de <strong className="text-foreground">@{info.username}</strong></p>
        <h1 className="text-2xl font-bold leading-tight">{info.titulo}</h1>
        <ResumoCard resumo={info.resumo} />
        <div className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{progress}% preenchido · salvo automaticamente</p>
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">1. Seus dados</h2>
        <label className="block" data-field="nome"><Label>Nome completo</Label>
          <input className={inputCls} autoComplete="name" value={form.nome} onChange={(e) => set("nome", e.target.value)} /><Err msg={errors.nome} /></label>
        <label className="block" data-field="whatsapp"><Label>WhatsApp</Label>
          <input className={inputCls} type="tel" inputMode="tel" autoComplete="tel" placeholder="(33) 99999-9999" value={maskPhone(form.whatsapp)} onChange={(e) => set("whatsapp", e.target.value.replace(/\D/g, ""))} /><Err msg={errors.whatsapp} /></label>
        <label className="block" data-field="idade"><Label>Idade</Label>
          <input className={inputCls} type="number" inputMode="numeric" min={1} max={99} value={form.idade} onChange={(e) => set("idade", e.target.value.replace(/\D/g, "").slice(0, 2))} />
          {menor ? <p className="mt-2 rounded-xl bg-muted p-3 text-sm">Obrigado pelo interesse! Esta vaga é só para maiores de 18 anos. Quando completar 18, vai ser um prazer receber seu cadastro. 💛</p> : <Err msg={errors.idade} />}
        </label>
        {!menor && <>
          <label className="block" data-field="bairro"><Label>Bairro</Label>
            <input className={inputCls} value={form.bairro} onChange={(e) => set("bairro", e.target.value)} /><Err msg={errors.bairro} /></label>
          <label className="block" data-field="cidade"><Label>Cidade</Label>
            <input className={inputCls} value={form.cidade} onChange={(e) => set("cidade", e.target.value)} /><Err msg={errors.cidade} /></label>
          <div data-field="transporte"><Label>Como você vem para o trabalho?</Label>
            <div className="grid grid-cols-2 gap-2">{TRANSPORTES.map(([v, l]) => <Btn key={v} active={form.transporte === v} onClick={() => set("transporte", v)}>{l}</Btn>)}</div>
            <Err msg={errors.transporte} /></div>
        </>}
      </section>

      {!menor && <>
        <section className="space-y-3" data-field="aceita_condicoes">
          <h2 className="text-lg font-bold">2. Condições</h2>
          <p>Você topa trabalhar com R$ 1.950 fixo + comissão + bônus, escala 5x2, sábado e dias de live até as 19h?</p>
          <div className="grid grid-cols-2 gap-2"><Btn active={form.aceita_condicoes === true} onClick={() => set("aceita_condicoes", true)}>Sim</Btn><Btn active={form.aceita_condicoes === false} onClick={() => set("aceita_condicoes", false)}>Não</Btn></div>
          <Err msg={errors.aceita_condicoes} />
        </section>

        <section className="space-y-3" data-field="ja_trabalhou">
          <h2 className="text-lg font-bold">3. Experiência</h2>
          <p>Já trabalhou antes? (mesmo sem carteira assinada)</p>
          <div className="grid grid-cols-2 gap-2">
            <Btn active={form.ja_trabalhou === true} onClick={() => setForm((f) => ({ ...f, ja_trabalhou: true, experiencias: f.experiencias.length ? f.experiencias : [newExp()] }))}>Sim</Btn>
            <Btn active={form.ja_trabalhou === false} onClick={() => set("ja_trabalhou", false)}>Não</Btn>
          </div>
          <Err msg={errors.ja_trabalhou || errors.experiencias} />
          {form.ja_trabalhou && <>
            <p className="rounded-xl bg-muted p-3 text-sm">Coloque todos os trabalhos que já teve, até bicos e sem carteira. Quanto mais, melhor!</p>
            {form.experiencias.map((x, i) => (
              <div key={i} className="space-y-3 rounded-xl border border-border p-3" data-field={`experiencias.${i}`}>
                <div className="flex items-center justify-between"><span className="text-sm font-semibold">Trabalho {i + 1}</span>
                  {form.experiencias.length > 1 && <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setForm((f) => ({ ...f, experiencias: f.experiencias.filter((_, j) => j !== i) }))}>Remover</button>}</div>
                <label className="block"><Label>Onde</Label><input className={inputCls} value={x.onde} onChange={(e) => setExp(i, { onde: e.target.value })} /></label>
                <label className="block"><Label>O que fazia</Label><input className={inputCls} value={x.funcao} onChange={(e) => setExp(i, { funcao: e.target.value })} /></label>
                <div><Label>Quanto tempo ficou</Label>
                  <div className="flex items-stretch gap-2 min-w-0">
                    <input className={`${inputCls.replace("w-full", "")} w-24 shrink-0`} type="number" inputMode="decimal" min={1} value={x.tempo} onChange={(e) => setExp(i, { tempo: e.target.value.slice(0, 4) })} />
                    <Btn className="flex-1 min-w-0 px-2" active={x.unidade === "meses"} onClick={() => setExp(i, { unidade: "meses" })}>meses</Btn>
                    <Btn className="flex-1 min-w-0 px-2" active={x.unidade === "anos"} onClick={() => setExp(i, { unidade: "anos" })}>anos</Btn>
                  </div><p className="mt-1 text-xs text-muted-foreground">Escolha meses ou anos</p></div>
                <Err msg={errors[`experiencias.${i}`]} />
              </div>
            ))}
            {form.experiencias.length < MAX_EXP && (
              <button type="button" className="min-h-12 w-full rounded-xl border border-dashed border-primary text-base font-semibold text-primary" onClick={() => setForm((f) => ({ ...f, experiencias: [...f.experiencias, newExp()] }))}>+ Adicionar outra experiência</button>
            )}
          </>}
        </section>

        <section className="space-y-3" data-field="computador">
          <h2 className="text-lg font-bold">4. Computador</h2>
          <p>Você usa computador?</p>
          <div className="grid grid-cols-3 gap-2">{COMPUTADOR.map(([v, l]) => <Btn key={v} active={form.computador === v} onClick={() => set("computador", v)}>{l}</Btn>)}</div>
          <Err msg={errors.computador} />
        </section>

        <section className="space-y-3" data-field="situacao">
          <h2 className="text-lg font-bold">5. Uma situação real</h2>
          <p>{nuncaTrabalhou
            ? "Conte uma situação no trabalho, na escola, em casa ou em qualquer lugar que você não gostou e como você reagiu."
            : "Conte uma situação no trabalho anterior que você não gostou e como você reagiu."} <span className="text-muted-foreground">(2 ou 3 frases)</span></p>
          <textarea className={`${inputCls} h-32 py-2`} value={form.situacao} maxLength={1500} onChange={(e) => set("situacao", e.target.value)} />
          <Err msg={errors.situacao} />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold">6. Teste de atendimento</h2>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 font-semibold">Como a gente atende</p>
            <div className="space-y-1.5 whitespace-pre-line text-sm leading-relaxed">{info.guia}</div>
          </div>
          <p className="text-sm text-muted-foreground">Responda cada cliente como se fosse no WhatsApp da loja.</p>
          {info.cenarios.map((c, i) => (
            <div key={c.id} className="space-y-2 rounded-xl bg-muted p-3" data-field={`respostas.${c.id}`}>
              <p className="text-xs font-semibold text-muted-foreground">Cliente {i + 1}</p>
              {c.contexto && <p className="text-xs italic text-muted-foreground">{c.contexto}</p>}
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-card px-3 py-2 text-base shadow-sm">{c.mensagem}</div>
              <textarea className={`${inputCls} h-24 py-2`} placeholder="Sua resposta…" maxLength={600} value={form.respostas[c.id] || ""}
                onChange={(e) => setForm((f) => ({ ...f, respostas: { ...f.respostas, [c.id]: e.target.value } }))} />
              <Err msg={errors[`respostas.${c.id}`]} />
            </div>
          ))}
        </section>

        <section className="space-y-3" data-field="consentimento">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-primary" checked={form.consentimento} onChange={(e) => set("consentimento", e.target.checked)} />
            <span>Ao enviar, você autoriza a Banana Calçados a usar seus dados somente para este processo seletivo.</span>
          </label>
          <Err msg={errors.consentimento} />
          {errors.geral && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{errors.geral}</p>}
          <button type="button" disabled={sending} onClick={submit}
            className="min-h-14 w-full rounded-xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-60">
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </section>
      </>}
    </div>,
  );
}
