import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ImagePlus, Info, Loader2, Lock, RefreshCw, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  callLink, friendly, LinkError, previewParts, headerFormat, configKey, brasiliaToIso, formatBrasilia, COMM_LABELS,
  type Tpl, type VarCfg,
} from "@/lib/dispatchLinkPublic";

type Instance = { id: string; label: string; templates: Tpl[] };
type Options = {
  link_name: string; instances: Instance[]; audiences: { key: string; label: string }[]; comm_types: string[];
  allow_send_now: boolean; allow_schedule: boolean; max_recipients: number;
};
type Step = "senha" | "instancia" | "modelo" | "publico" | "teste" | "resumo" | "fim";
const ORDER: Step[] = ["senha", "instancia", "modelo", "publico", "teste", "resumo", "fim"];
const TITLES: Record<Step, string> = {
  senha: "Entrar", instancia: "Qual WhatsApp vai enviar", modelo: "Escolha a mensagem", publico: "Para quem vai",
  teste: "Teste no seu celular", resumo: "Conferir e enviar", fim: "Andamento",
};

function HowTo({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-[15px] leading-relaxed">
      <div className="mb-1 flex items-center gap-2 font-semibold text-primary"><Info className="h-4 w-4" /> Como fazer</div>
      <div className="text-foreground/90">{children}</div>
    </div>
  );
}

function ErrorBox({ text }: { text: string | null }) {
  if (!text) return null;
  return <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-[15px] text-destructive">{text}</div>;
}

function Choice({ active, onClick, title, sub }: { active: boolean; onClick: () => void; title: string; sub?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`w-full rounded-xl border-2 p-4 text-left transition ${active ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
      <div className="text-base font-semibold">{title}</div>
      {sub && <div className="mt-0.5 text-sm text-muted-foreground">{sub}</div>}
    </button>
  );
}

export default function DispatchLinkWizard() {
  const { codigo = "" } = useParams();
  const [step, setStep] = useState<Step>("senha");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // senha
  const [linkName, setLinkName] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [lockedMin, setLockedMin] = useState<number | null>(null);
  const token = useRef<string | null>(null); // só na memória da aba
  const [opts, setOpts] = useState<Options | null>(null);

  // escolhas
  const [instanceId, setInstanceId] = useState("");
  const [tplKey, setTplKey] = useState("");
  const [vars, setVars] = useState<Record<string, VarCfg>>({});
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [commType, setCommType] = useState("");
  const [audienceKey, setAudienceKey] = useState("");
  const [count, setCount] = useState<{ total: number; exceeds: boolean } | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testedKey, setTestedKey] = useState<string | null>(null);
  const [testSimulated, setTestSimulated] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule" | "">("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);

  const instance = opts?.instances.find((i) => i.id === instanceId) || null;
  const tpl = instance?.templates.find((t) => `${t.name}|${t.language}` === tplKey) || null;
  const hdr = headerFormat(tpl);
  const curKey = useMemo(() => configKey(instanceId, tpl, vars, image), [instanceId, tpl, vars, image]);
  const testOk = testedKey !== null && testedKey === curKey;
  const testStale = testedKey !== null && testedKey !== curKey;
  const audience = opts?.audiences.find((a) => a.key === audienceKey) || null;

  useEffect(() => {
    let alive = true;
    callLink<{ link_name: string }>("info", { code: codigo })
      .then((r) => alive && setLinkName(r.link_name))
      .catch((e) => alive && setLinkDead(friendly(e)));
    return () => { alive = false; };
  }, [codigo]);

  const handleErr = (e: unknown) => {
    if (e instanceof LinkError && ["sessao_invalida", "sessao_expirada", "link_inativo", "link_vencido"].includes(e.code)) {
      token.current = null; setOpts(null); setStep("senha");
    }
    setErr(friendly(e));
  };

  const go = (s: Step) => { setErr(null); setConfirming(false); setStep(s); window.scrollTo(0, 0); };

  const visible = ORDER.filter((s) => !(s === "instancia" && (opts?.instances.length ?? 0) <= 1));
  const idx = visible.indexOf(step);
  const back = () => { if (idx > 1 && step !== "fim") go(visible[idx - 1]); };

  async function login() {
    setBusy(true); setErr(null); setLockedMin(null);
    try {
      const r = await callLink<{ token: string }>("login", { code: codigo, password });
      token.current = r.token; setPassword("");
      const o = await callLink<Options>("options", { token: r.token });
      setOpts(o);
      if (o.instances.length === 1) { setInstanceId(o.instances[0].id); go("modelo"); } else go("instancia");
    } catch (e) {
      if (e instanceof LinkError && e.code === "bloqueado") setLockedMin(Number(e.extra.minutes) || 15);
      else handleErr(e);
    } finally { setBusy(false); }
  }

  function pickTemplate(t: Tpl) {
    setTplKey(`${t.name}|${t.language}`);
    const v: Record<string, VarCfg> = {};
    for (const k of t.variable_keys) v[k] = vars[k] && tplKey === `${t.name}|${t.language}` ? vars[k] : { mode: "__static__", staticValue: "" };
    setVars(v);
    if (headerFormat(t) !== "IMAGE") setImage(null);
  }

  async function uploadImage(file: File) {
    setErr(null);
    if (!["image/jpeg", "image/png"].includes(file.type)) return setErr("Use uma foto JPG ou PNG.");
    if (file.size > 5 * 1024 * 1024) return setErr("A foto precisa ter até 5 MB.");
    setUploading(true);
    try {
      const u = await callLink<{ path: string; upload_url: string }>("upload_url", { token: token.current, content_type: file.type, size: file.size });
      const put = await fetch(u.upload_url, { method: "PUT", headers: { "Content-Type": file.type, "x-upsert": "false" }, body: file });
      if (!put.ok) throw new LinkError("upload", "Não consegui enviar a foto. Tente de novo.");
      const c = await callLink<{ url: string }>("confirm_upload", { token: token.current, path: u.path });
      setImage(c.url);
    } catch (e) { handleErr(e); } finally { setUploading(false); }
  }

  const varsFilled = tpl ? tpl.variable_keys.every((k) => vars[k]?.mode !== "__static__" || (vars[k]?.staticValue || "").trim()) : false;
  const modelReady = !!tpl && varsFilled && (hdr !== "IMAGE" || !!image);

  async function pickAudience(key: string) {
    setAudienceKey(key); setCount(null); setErr(null); setBusy(true);
    try {
      const r = await callLink<{ total: number; exceeds: boolean }>("count", { token: token.current, audience_key: key });
      setCount({ total: r.total, exceeds: r.exceeds });
    } catch (e) { handleErr(e); } finally { setBusy(false); }
  }

  const cfgBody = () => ({
    token: token.current, instance_id: instanceId, template_name: tpl?.name, language: tpl?.language,
    variables: vars, header_media_url: hdr === "IMAGE" ? image : null,
  });

  async function sendTest() {
    setBusy(true); setErr(null);
    try {
      const r = await callLink<{ simulated: boolean }>("send_test", { ...cfgBody(), test_phone: testPhone });
      setTestedKey(curKey); setTestSimulated(r.simulated);
    } catch (e) { handleErr(e); } finally { setBusy(false); }
  }

  const scheduledIso = mode === "schedule" ? brasiliaToIso(date, time) : null;
  const summaryReady = mode === "now" || (mode === "schedule" && !!scheduledIso);

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      const r = await callLink("create_dispatch", {
        ...cfgBody(), comm_type: commType, audience_key: audienceKey, mode, scheduled_at: scheduledIso,
      });
      setResult(r); setTestedKey(null); go("fim");
      if (r.dispatch_id) refresh(r.dispatch_id);
    } catch (e) { handleErr(e); setConfirming(false); } finally { setBusy(false); }
  }

  async function refresh(id = result?.dispatch_id) {
    if (!id) return;
    setBusy(true); setErr(null);
    try { setStatus((await callLink("status", { token: token.current, dispatch_id: id })).dispatch); }
    catch (e) { handleErr(e); } finally { setBusy(false); }
  }

  const p = tpl ? previewParts(tpl, vars) : null;
  const total = count?.total ?? 0;

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto flex min-h-screen w-full max-w-[440px] flex-col bg-background shadow-sm">
        <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pb-3 pt-4 backdrop-blur">
          <div className="flex items-center gap-2">
            {idx > 1 && step !== "fim" ? (
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={back} aria-label="Voltar"><ArrowLeft className="h-6 w-6" /></Button>
            ) : <div className="h-11 w-2" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-muted-foreground">{linkName || opts?.link_name || "Link de disparo"}</div>
              <h1 className="truncate text-lg font-bold">{TITLES[step]}</h1>
            </div>
            <div className="text-sm text-muted-foreground">{Math.max(idx, 0) + 1}/{visible.length}</div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((Math.max(idx, 0) + 1) / visible.length) * 100}%` }} />
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 p-4 text-base">
          {step === "senha" && (
            linkDead ? <ErrorBox text={linkDead} /> : (
              <>
                <HowTo>Digite a senha que o Matthews te passou e toque em <b>Entrar</b>. Se errar muitas vezes, o link trava por alguns minutos.</HowTo>
                {linkName && <div className="rounded-xl bg-card p-4 text-center"><div className="text-sm text-muted-foreground">Você está entrando em</div><div className="text-xl font-bold">{linkName}</div></div>}
                <label className="text-sm font-medium" htmlFor="senha">Senha</label>
                <Input id="senha" type="password" autoComplete="current-password" className="h-14 text-lg" value={password}
                  onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && password && !busy && login()} />
                {lockedMin !== null && (
                  <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                    <Lock className="mt-0.5 h-5 w-5 shrink-0" /> Muitas tentativas erradas. Espere uns {lockedMin} minuto(s) e tente de novo.
                  </div>
                )}
                <ErrorBox text={err} />
                <Button className="h-14 text-lg" disabled={!password || busy || !linkName} onClick={login}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Entrar"}
                </Button>
              </>
            )
          )}

          {step === "instancia" && opts && (
            <>
              <HowTo>Escolha qual WhatsApp da loja vai mandar a mensagem. Depois toque em <b>Continuar</b>.</HowTo>
              {opts.instances.map((i) => <Choice key={i.id} active={instanceId === i.id} title={i.label} sub={`${i.templates.length} mensagem(ns) pronta(s)`} onClick={() => { setInstanceId(i.id); setTplKey(""); setVars({}); setImage(null); }} />)}
              <ErrorBox text={err} />
              <Button className="mt-auto h-14 text-lg" disabled={!instanceId} onClick={() => go("modelo")}>Continuar</Button>
            </>
          )}

          {step === "modelo" && instance && (
            <>
              <HowTo>Toque na mensagem que quer mandar. Preencha os espaços em branco: pode escrever um texto ou usar o nome da cliente. Se pedir foto, escolha uma foto do celular. Embaixo aparece como a mensagem vai chegar.</HowTo>
              {instance.templates.length === 0 && <ErrorBox text="Nenhuma mensagem liberada para este link. Fale com o Matthews." />}
              <div className="flex flex-col gap-2">
                {instance.templates.map((t) => <Choice key={`${t.name}|${t.language}`} active={tplKey === `${t.name}|${t.language}`} title={t.name.replace(/_/g, " ")} sub={headerFormat(t) === "IMAGE" ? "Com foto" : "Só texto"} onClick={() => pickTemplate(t)} />)}
              </div>

              {tpl && tpl.variable_keys.length > 0 && (
                <div className="flex flex-col gap-3 rounded-xl border p-3">
                  <div className="font-semibold">Espaços para preencher</div>
                  {tpl.variable_keys.map((k, n) => {
                    const v = vars[k] || { mode: "__static__", staticValue: "" };
                    const isBtn = k.startsWith("button_url_");
                    return (
                      <div key={k} className="flex flex-col gap-2">
                        <div className="text-sm font-medium">{isBtn ? "Final do link do botão" : `Espaço ${n + 1}`}</div>
                        {!isBtn && (
                          <div className="grid grid-cols-3 gap-2">
                            {([["__static__", "Texto"], ["__first_name__", "1º nome"], ["__full_name__", "Nome todo"]] as const).map(([m, l]) => (
                              <Button key={m} type="button" variant={v.mode === m ? "default" : "outline"} className="h-11"
                                onClick={() => setVars({ ...vars, [k]: { mode: m, staticValue: v.staticValue } })}>{l}</Button>
                            ))}
                          </div>
                        )}
                        {v.mode === "__static__" && (
                          <Input aria-label={`Texto do espaço ${n + 1}`} className="h-12" maxLength={500} placeholder="Escreva aqui" value={v.staticValue || ""}
                            onChange={(e) => setVars({ ...vars, [k]: { mode: "__static__", staticValue: e.target.value } })} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {tpl && hdr === "IMAGE" && (
                <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed text-base font-medium">
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  {image ? "Trocar a foto" : "Escolher a foto"}
                  <input type="file" accept="image/jpeg,image/png" className="hidden" disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadImage(f); }} />
                </label>
              )}

              {p && (
                <div>
                  <div className="mb-1 text-sm font-medium text-muted-foreground">Assim vai chegar (com nome de exemplo):</div>
                  <div className="rounded-2xl bg-secondary p-3">
                    <div className="max-w-[92%] overflow-hidden rounded-xl bg-card shadow-sm">
                      {hdr === "IMAGE" && (image ? <img src={image} alt="Foto da mensagem" className="max-h-64 w-full object-cover" /> : <div className="flex h-32 items-center justify-center bg-muted text-sm text-muted-foreground">foto aqui</div>)}
                      <div className="whitespace-pre-wrap p-3 text-[15px]">
                        {p.header && <div className="mb-1 font-bold">{p.header}</div>}
                        {p.body}
                        {p.footer && <div className="mt-2 text-xs text-muted-foreground">{p.footer}</div>}
                      </div>
                      {p.buttons.map((b, i) => <div key={i} className="border-t p-2 text-center text-sm font-medium text-primary">{b}</div>)}
                    </div>
                  </div>
                </div>
              )}
              {testStale && <div className="flex gap-2 rounded-xl border border-accent bg-accent/20 p-3 text-sm"><AlertTriangle className="h-5 w-5 shrink-0" /> Você mudou a mensagem. Vai precisar fazer o teste de novo.</div>}
              <ErrorBox text={err} />
              <Button className="mt-auto h-14 text-lg" disabled={!modelReady || uploading} onClick={() => go("publico")}>Continuar</Button>
            </>
          )}

          {step === "publico" && opts && (
            <>
              <HowTo>Escolha o <b>tipo</b> da mensagem e depois <b>para quem</b> vai. Aparece quantas pessoas vão receber. Quem pediu para não receber fica de fora sozinho.</HowTo>
              <div className="font-semibold">Tipo da mensagem</div>
              <div className="grid grid-cols-2 gap-2">
                {opts.comm_types.map((c) => <Button key={c} variant={commType === c ? "default" : "outline"} className="h-12 whitespace-normal" onClick={() => setCommType(c)}>{COMM_LABELS[c] || c}</Button>)}
              </div>
              <div className="mt-2 font-semibold">Para quem</div>
              {opts.audiences.map((a) => <Choice key={a.key} active={audienceKey === a.key} title={a.label} onClick={() => pickAudience(a.key)} />)}
              {busy && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Contando…</div>}
              {count && (
                <div className={`rounded-xl p-4 text-center ${count.exceeds ? "bg-destructive/10 text-destructive" : "bg-primary/10"}`}>
                  <div className="text-3xl font-bold">{count.total.toLocaleString("pt-BR")}</div>
                  <div className="text-sm">{count.exceeds ? `pessoas — passa do máximo deste link (${opts.max_recipients.toLocaleString("pt-BR")}). Fale com o Matthews.` : "pessoas nesse público"}</div>
                </div>
              )}
              <ErrorBox text={err} />
              <Button className="mt-auto h-14 text-lg" disabled={!commType || !audienceKey || !count || count.exceeds || busy} onClick={() => go("teste")}>Continuar</Button>
            </>
          )}

          {step === "teste" && (
            <>
              <HowTo>Digite <b>o seu</b> WhatsApp com DDD e toque em <b>Enviar teste</b>. Abra seu WhatsApp e veja se a mensagem chegou certinha. Só depois disso dá para seguir.</HowTo>
              {testStale && <div className="flex gap-2 rounded-xl border border-accent bg-accent/20 p-3 text-sm"><AlertTriangle className="h-5 w-5 shrink-0" /> Você mudou a mensagem depois do último teste. Faça o teste de novo.</div>}
              <label className="text-sm font-medium" htmlFor="tel">Seu WhatsApp (com DDD)</label>
              <Input id="tel" inputMode="tel" className="h-14 text-lg" placeholder="(33) 99999-9999" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
              <Button variant={testOk ? "outline" : "default"} className="h-14 text-lg" disabled={busy || testPhone.replace(/\D/g, "").length < 10} onClick={sendTest}>
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Send className="mr-2 h-5 w-5" /> {testOk ? "Enviar outro teste" : "Enviar teste"}</>}
              </Button>
              {testOk && (
                <div className="rounded-xl border border-primary/40 bg-primary/10 p-4">
                  <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5 text-primary" /> Teste enviado!</div>
                  <div className="mt-1">Chegou no seu WhatsApp? Confira antes de seguir.</div>
                  {testSimulated && <div className="mt-2 text-sm text-muted-foreground">(Link de treino: nenhuma mensagem de verdade foi enviada.)</div>}
                </div>
              )}
              <ErrorBox text={err} />
              <Button className="mt-auto h-14 text-lg" disabled={!testOk} onClick={() => go("resumo")}>Chegou certinho, continuar</Button>
            </>
          )}

          {step === "resumo" && opts && tpl && (
            <>
              <HowTo>Confira tudo. Escolha <b>Enviar agora</b> ou <b>Agendar</b> (horário de Brasília). Depois toque em <b>Confirmar</b> e confirme mais uma vez.</HowTo>
              <dl className="divide-y rounded-xl border">
                {[["Mensagem", tpl.name.replace(/_/g, " ")], ["WhatsApp", instance?.label || ""], ["Público", audience?.label || ""],
                  ["Quantidade", `${total.toLocaleString("pt-BR")} pessoas`], ["Tipo", COMM_LABELS[commType] || commType]].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 p-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
                ))}
              </dl>
              <div className="grid grid-cols-2 gap-2">
                {opts.allow_send_now && <Button variant={mode === "now" ? "default" : "outline"} className="h-14 text-base" onClick={() => { setMode("now"); setConfirming(false); }}>Enviar agora</Button>}
                {opts.allow_schedule && <Button variant={mode === "schedule" ? "default" : "outline"} className="h-14 text-base" onClick={() => { setMode("schedule"); setConfirming(false); }}>Agendar</Button>}
              </div>
              {mode === "schedule" && (
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-sm" htmlFor="data">Dia</label><Input id="data" type="date" className="h-12" value={date} onChange={(e) => { setDate(e.target.value); setConfirming(false); }} /></div>
                  <div><label className="text-sm" htmlFor="hora">Hora (Brasília)</label><Input id="hora" type="time" className="h-12" value={time} onChange={(e) => { setTime(e.target.value); setConfirming(false); }} /></div>
                </div>
              )}
              {testStale || !testOk ? <ErrorBox text="Faça o teste antes de confirmar." /> : null}
              <ErrorBox text={err} />
              {!confirming ? (
                <Button className="mt-auto h-14 text-lg" disabled={!summaryReady || !testOk || busy} onClick={() => setConfirming(true)}>Confirmar</Button>
              ) : (
                <div className="mt-auto flex flex-col gap-2 rounded-xl border-2 border-destructive/50 p-3">
                  <div className="text-center text-lg font-bold">Tem certeza? Vai para {total.toLocaleString("pt-BR")} pessoas{mode === "schedule" && scheduledIso ? ` em ${formatBrasilia(scheduledIso)}` : ""}.</div>
                  <Button className="h-14 text-lg" disabled={busy} onClick={confirm}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sim, pode enviar"}</Button>
                  <Button variant="outline" className="h-12" disabled={busy} onClick={() => setConfirming(false)}>Não, voltar</Button>
                </div>
              )}
            </>
          )}

          {step === "fim" && result && (
            <>
              <HowTo>Pronto! O envio acontece aos poucos para não travar o WhatsApp. Toque em <b>Atualizar</b> quando quiser ver quantas já foram.</HowTo>
              <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
                {result.simulated ? (
                  <>
                    <div className="mt-2 text-lg font-bold">Treino concluído</div>
                    <div className="text-sm">Link de treino: nada foi enviado. Iria para {Number(result.would_enqueue).toLocaleString("pt-BR")} pessoas{result.scheduled_at ? ` em ${formatBrasilia(result.scheduled_at)}` : ""}.</div>
                  </>
                ) : (
                  <>
                    <div className="mt-2 text-lg font-bold">{result.scheduled_at ? `Agendado para ${formatBrasilia(result.scheduled_at)}` : "Disparo iniciado"}</div>
                    <div className="text-sm">{Number(result.enqueued).toLocaleString("pt-BR")} pessoas na fila{result.excluded ? ` · ${result.excluded} ficaram de fora (descadastro/bloqueio)` : ""}</div>
                  </>
                )}
              </div>
              {status && (
                <dl className="divide-y rounded-xl border">
                  {[["Situação", ({ sending: "Enviando", scheduled: "Agendado", completed: "Terminado", failed: "Falhou", pending: "Preparando" } as any)[status.status] || status.status],
                    ["Enviadas", String(status.sent_count ?? 0)], ["Falharam", String(status.failed_count ?? 0)], ["Total", String(status.total_recipients ?? 0)]].map(([k, v]) => (
                    <div key={k} className="flex justify-between p-3"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>
                  ))}
                </dl>
              )}
              <ErrorBox text={err} />
              {!result.simulated && <Button className="h-14 text-lg" disabled={busy} onClick={() => refresh()}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><RefreshCw className="mr-2 h-5 w-5" /> Atualizar</>}</Button>}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
