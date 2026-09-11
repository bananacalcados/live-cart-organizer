import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useDebouncedSearchInput — campo de busca "controlado localmente":
 * o texto digitado fica no estado local (o input responde a cada tecla), e o
 * valor só é propagado para o pai (`onChange`) após uma pausa de `delayMs`.
 * Assim a tela-mãe (que filtra centenas de conversas) não é redesenhada a cada
 * caractere.
 *
 * Mudanças vindas do pai (ex.: limpar com Esc) são refletidas no input.
 */
export function useDebouncedSearchInput(
  value: string,
  onChange: (next: string) => void,
  delayMs = 250,
): [string, (next: string) => void] {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<number | null>(null);
  const lastEmittedRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Pai mudou o valor por conta própria → espelha no input.
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLocal(value);
  }, [value]);

  const update = useCallback((next: string) => {
    setLocal(next);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    // Limpar o campo propaga na hora (a lista volta ao normal sem espera).
    const wait = next === "" ? 0 : delayMs;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      lastEmittedRef.current = next;
      onChangeRef.current(next);
    }, wait);
  }, [delayMs]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  return [local, update];
}
