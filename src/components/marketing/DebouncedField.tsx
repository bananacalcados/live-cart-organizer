import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface BaseProps {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  delay?: number;
}

function useDebouncedValue(value: string, onCommit: (v: string) => void, delay: number) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const dirty = useRef(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // Sync from outside only when the user is not mid-typing
  useEffect(() => {
    if (!dirty.current) setLocal(value);
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handle = (v: string) => {
    dirty.current = true;
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirty.current = false;
      commitRef.current(v);
    }, delay);
  };

  const flush = () => {
    if (!dirty.current) return;
    clearTimeout(timer.current);
    dirty.current = false;
    commitRef.current(local);
  };

  return { local, handle, flush };
}

export function DebouncedInput({ value, onCommit, placeholder, className, delay = 600 }: BaseProps) {
  const { local, handle, flush } = useDebouncedValue(value, onCommit, delay);
  return (
    <Input
      value={local}
      onChange={(e) => handle(e.target.value)}
      onBlur={flush}
      placeholder={placeholder}
      className={className}
    />
  );
}

export function DebouncedTextarea({ value, onCommit, placeholder, className, delay = 600 }: BaseProps) {
  const { local, handle, flush } = useDebouncedValue(value, onCommit, delay);
  return (
    <Textarea
      value={local}
      onChange={(e) => handle(e.target.value)}
      onBlur={flush}
      placeholder={placeholder}
      className={className}
    />
  );
}
