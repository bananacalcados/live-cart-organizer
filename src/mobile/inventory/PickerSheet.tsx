import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dictKey, findEquivalent } from "./productCreate";

/** Janela em tela cheia (mesmo padrão do CategorySheet): fica por cima de tudo, trava a rolagem do fundo e devolve o foco ao fechar. */
export function PickerSheet({ title, options, selected, multi = false, createLabel, confirmCreate, onClose }: {
  title: string; options: string[]; selected: string[]; multi?: boolean;
  /** Texto do botão de criar (ex.: "Criar nova"); sem ele não cria. */
  createLabel?: string;
  /** Pergunta antes de criar (tamanhos). Devolve a mensagem de erro ou null. */
  confirmCreate?: { question: (v: string) => string; validate?: (v: string) => string | null };
  /** null = fechou sem mudar. */
  onClose: (values: string[] | null, note?: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>(selected);
  const [ask, setAsk] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const ov = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => { document.body.style.overflow = ov; prev?.focus?.(); };
  }, []);
  const k = dictKey(q);
  const shown = useMemo(() => (k ? options.filter((o) => dictKey(o).includes(k)) : options), [options, k]);
  const isOn = (o: string) => sel.some((s) => dictKey(s) === dictKey(o));
  const pick = (o: string) => {
    if (!multi) return onClose([o]);
    setSel(isOn(o) ? sel.filter((s) => dictKey(s) !== dictKey(o)) : [...sel, o]);
  };
  const create = () => {
    const t = q.trim(); if (!t) return;
    const eq = findEquivalent(options, t);
    if (eq) { setNote(`"${eq}" já existe e foi selecionado.`); if (!isOn(eq)) pick(eq); else if (!multi) onClose([eq]); setQ(""); return; }
    const err = confirmCreate?.validate?.(t);
    if (err) { setNote(err); return; }
    if (confirmCreate && ask !== t) { setAsk(t); return; }
    setAsk(null); setQ("");
    if (!multi) return onClose([t], "novo");
    setSel([...sel, t]);
  };
  const canCreate = !!createLabel && !!q.trim() && !findEquivalent(options, q) && !sel.some((s) => dictKey(s) === k);
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex h-14 items-center gap-2 border-b px-3">
        <Button variant="ghost" className="h-11 gap-1" onClick={() => onClose(null)}><X className="h-5 w-5" />Fechar</Button>
        <h2 className="flex-1 truncate font-bold">{title}</h2>
      </header>
      <form className="flex gap-2 p-3" onSubmit={(e) => { e.preventDefault(); const eq = findEquivalent(options, q); if (eq) { setNote(`"${eq}" já existe e foi selecionado.`); if (!isOn(eq) || !multi) pick(eq); setQ(""); } else if (canCreate) create(); }}>
        <Input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setAsk(null); setNote(null); }} placeholder="Pesquisar" className="h-12 text-base" enterKeyHint="search" />
      </form>
      {note && <p className="px-3 pb-2 text-sm text-muted-foreground" role="status">{note}</p>}
      {ask && (
        <div className="mx-3 mb-2 space-y-2 rounded-lg border border-destructive p-3" role="alertdialog">
          <p className="text-sm font-medium">{confirmCreate!.question(ask)}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-12" onClick={() => setAsk(null)}>Cancelar</Button>
            <Button className="h-12" onClick={create}>Criar "{ask}"</Button>
          </div>
        </div>
      )}
      <ul className="flex-1 overflow-y-auto overscroll-contain px-3">
        {canCreate && !ask && (
          <li><button type="button" className="flex min-h-[52px] w-full items-center gap-3 border-b text-left font-medium text-primary" onClick={create}>
            <Plus className="h-5 w-5" /><span className="flex-1 truncate">{createLabel}: {q.trim()}</span></button></li>
        )}
        {shown.map((o) => {
          const on = isOn(o);
          return (
            <li key={o}>
              <button type="button" aria-pressed={on} className="flex min-h-[52px] w-full items-center gap-3 border-b text-left" onClick={() => pick(o)}>
                <span className={`flex h-6 w-6 items-center justify-center rounded border ${on ? "bg-primary text-primary-foreground" : ""}`}>{on && <Check className="h-4 w-4" />}</span>
                <span className="flex-1 truncate">{o}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && !canCreate && <li className="py-6 text-center text-sm text-muted-foreground">Nada encontrado.</li>}
      </ul>
      {multi && <div className="border-t p-3"><Button className="h-14 w-full text-base" onClick={() => onClose(sel)}>Aplicar ({sel.length})</Button></div>}
    </div>
  );
}

/** Caixa que abre a janela (substitui lista nativa do navegador). */
export function PickerField({ label, value, placeholder = "Toque para escolher", onOpen }: { label: string; value: string; placeholder?: string; onOpen: () => void }) {
  return (
    <div><span className="mb-1 block text-sm font-medium">{label}</span>
      <button type="button" onClick={onOpen} aria-haspopup="dialog"
        className="flex h-12 w-full items-center rounded-md border bg-background px-3 text-left text-base">
        <span className={`flex-1 truncate ${value ? "" : "text-muted-foreground"}`}>{value || placeholder}</span>
      </button>
    </div>
  );
}
