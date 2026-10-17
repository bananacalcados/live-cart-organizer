import { forwardRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  invalid?: boolean;
}

export const InstallmentPicker = forwardRef<HTMLButtonElement, Props>(
  ({ value, options, onChange, invalid }, ref) => {
    const [open, setOpen] = useState(false);
    const selected = options.find((option) => option.value === value);
    return (
      <div className="space-y-2">
        <Button ref={ref} type="button" variant="outline" aria-label="Parcelas"
          aria-expanded={open} aria-invalid={invalid || undefined}
          onClick={() => setOpen((current) => !current)}
          className={`h-auto min-h-12 w-full justify-between whitespace-normal px-3 py-3 text-left ${invalid ? "border-2 border-destructive" : ""}`}>
          <span className="min-w-0 break-words">{selected?.label || "SELECIONE AS PARCELAS"}</span>
          <ChevronDown className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
        {open && (
          <div role="group" aria-label="Escolha as parcelas" className="max-h-72 overflow-y-auto rounded-md border border-input bg-background">
            {options.map((option) => (
              <Button key={option.value} type="button" variant="ghost"
                aria-pressed={value === option.value}
                onClick={() => { setOpen(false); onChange(option.value); }}
                className="h-auto min-h-12 w-full justify-start whitespace-normal rounded-none px-3 py-3 text-left aria-pressed:bg-accent aria-pressed:text-accent-foreground">
                {option.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
InstallmentPicker.displayName = "InstallmentPicker";