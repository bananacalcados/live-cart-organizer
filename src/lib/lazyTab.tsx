import { lazy, Suspense, type ComponentType } from "react";

/**
 * Carrega uma aba/tela só quando ela é exibida pela primeira vez.
 * Já inclui o próprio indicador de carregamento, então pode substituir
 * um import normal sem mudar o JSX de quem usa.
 */
export function lazyTab<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
) {
  const Lazy = lazy(loader);
  function LazyTab(props: P) {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" />
          </div>
        }
      >
        <Lazy {...(props as any)} />
      </Suspense>
    );
  }
  return LazyTab as unknown as ComponentType<P>;
}

/** Atalho para módulos com export nomeado. */
export function lazyNamed<M, K extends keyof M>(
  loader: () => Promise<M>,
  name: K,
): M[K] {
  return lazyTab(() => loader().then((m) => ({ default: m[name] as any }))) as unknown as M[K];
}
