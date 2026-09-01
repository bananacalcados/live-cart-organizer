# Ponto 4 — Cortar as 82 mil consultas de pedidos sem piscar a tela

Regra de ouro do plano: **nada de refresh periódico da tela inteira**. Nenhum `refetchInterval` no Kanban, nenhum recarregamento total a cada X segundos. A tela só muda quando um dado específico realmente mudou, e a mudança é aplicada linha a linha (o card muda, o resto fica parado).

## Como fica na prática

- **Kanban do evento**: continua carregando os pedidos uma única vez ao abrir o evento e, a partir daí, se atualiza pelo tempo real que já existe (`subscribeToEventOrders`). Pedido criado em outro PC aparece em 1-2 segundos, sem recarregar a lista.
- **Enquanto você monta um pedido**: qualquer atualização vinda de fora que toque no pedido aberto no modal fica em espera (fila) e só é aplicada quando você fecha o modal. Nada é sobrescrito debaixo da sua mão.
- **Histórico do cliente / Customer 360 / dashboards**: passam a usar cache compartilhado, então abrir o mesmo cliente 5 vezes = 1 consulta, não 5.

## O que muda tecnicamente

1. **Carregamento único + tempo real (Kanban)**
   - Remover qualquer refetch redundante de `fetchOrdersByEvent` (hoje ele roda de novo a cada troca de referência/foco).
   - Manter e reforçar o canal realtime: DELETE remove, INSERT/UPDATE faz `upsertOrderRealtime` (merge de um único pedido no array), sem `set({ orders })` completo.
   - Merge com comparação de conteúdo: se o pedido recebido for igual ao que já está em memória, não atualiza o estado (evita re-render inútil).

2. **Trava de edição (anti-pisca durante montagem)**
   - Novo estado no store: `lockedOrderIds`. Ao abrir o modal de pedido, o id entra na trava; ao fechar, sai e os updates represados são aplicados.
   - Updates realtime de pedidos travados vão para um buffer `pendingRealtime`, aplicados no unlock.

3. **Cards estáveis**
   - `OrderCardDb` memoizado (`React.memo`) com comparação por campos relevantes; lista com `key` = id do pedido.
   - Assim, quando um pedido muda, só aquele card re-renderiza — nada de a coluna inteira "reconstruir".

4. **React Query só onde é leitura repetida (sem tempo real necessário)**
   - Configurar o `QueryClient` global com `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `retry: 1` — isso sozinho já elimina uma boa parte das chamadas repetidas (hoje toda volta de aba dispara refetch).
   - `POSCustomer360` (pedidos por `customer_id`), `PrizeEligibleList` e consultas de dashboard por `event_id` passam a `useQuery` com `staleTime` de 60s (dashboards: 5 min).
   - Invalidação por evento explícito: ao criar/editar/pagar um pedido, o store invalida as chaves `['orders','customer',id]` e `['orders','event',id]`. Ou seja, atualiza por causa da ação, não por relógio.

5. **Sem flicker no carregamento**
   - `placeholderData: keepPreviousData` nas consultas que trocam de filtro/cliente, para a tela nunca voltar ao esqueleto de loading quando já tem dado na mão.

## Resultado esperado

- As ~82 mil consultas de `orders` caem para o essencial (1 por evento aberto + tempo real + 1 por cliente a cada 60s).
- Zero atualização automática de tela inteira; zero risco de perder o que está sendo montado.
