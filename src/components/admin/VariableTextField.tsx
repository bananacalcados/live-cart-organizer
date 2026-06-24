import { useRef } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmojiPickerButton } from "@/components/EmojiPickerButton";
import { Plus } from "lucide-react";
import { useState } from "react";
import { previewText, type VarDef } from "@/lib/pos/carouselTemplate";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  variables: VarDef[];
  onAddVariable: (v: VarDef) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}

export function VariableTextField({
  label,
  value,
  onChange,
  variables,
  onAddVariable,
  multiline,
  placeholder,
  hint,
}: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputRef = useRef<any>(null);
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeLabel, setFreeLabel] = useState("");
  const [freeExample, setFreeExample] = useState("");

  const insertAtCursor = (snippet: string) => {
    const el = inputRef.current;
    if (!el) {
      onChange(`${value}${snippet}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const addFree = () => {
    const lbl = freeLabel.trim();
    if (!lbl) return;
    const token = `livre_${Date.now().toString(36)}`;
    const def: VarDef = { token, label: lbl, example: freeExample.trim() || lbl };
    onAddVariable(def);
    insertAtCursor(`{{${token}}}`);
    setFreeLabel("");
    setFreeExample("");
    setFreeOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {variables.map((v) => (
          <Button
            key={v.token}
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => insertAtCursor(`{{${v.token}}}`)}
          >
            + {v.label}
          </Button>
        ))}
        <Popover open={freeOpen} onOpenChange={setFreeOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1">
              <Plus className="h-3 w-3" /> Variável livre
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome da variável</Label>
              <Input
                value={freeLabel}
                onChange={(e) => setFreeLabel(e.target.value)}
                placeholder="ex.: Cidade"
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Exemplo (para aprovação)</Label>
              <Input
                value={freeExample}
                onChange={(e) => setFreeExample(e.target.value)}
                placeholder="ex.: São Paulo"
                className="h-8"
              />
            </div>
            <Button type="button" size="sm" className="w-full" onClick={addFree}>
              Adicionar e inserir
            </Button>
          </PopoverContent>
        </Popover>
        <EmojiPickerButton
          className="h-7 w-7"
          onEmojiSelect={(emoji) => insertAtCursor(emoji)}
        />
      </div>
      {multiline ? (
        <Textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
        />
      ) : (
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {value.includes("{{") && (
        <p className="text-xs text-muted-foreground">
          Prévia: {previewText(value, variables)}
        </p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
