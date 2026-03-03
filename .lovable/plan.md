

## Diagnóstico e Plano

### Problema 1: Erro ao puxar pedidos do Tiny
A sincronização está funcionando corretamente no servidor (respondeu em 16.3s com sucesso). O erro que você viu foi um **timeout do navegador** -- a função demora ~16 segundos e o browser cortou a conexão antes de receber a resposta. Solução: aumentar o timeout da chamada no frontend.

### Problema 2: Verificação de pedidos não enviados
Atualmente não existe nenhum sistema que alerte sobre pedidos "travados" (aprovados há muito tempo sem despacho). Vou criar um painel de verificação.

---

### Mudanças planejadas

**1. Corrigir timeout da sincronização** (`src/pages/ExpeditionBeta.tsx`)
- Trocar `supabase.functions.invoke()` por `fetch()` direto com timeout de 120 segundos, já que a função pode demorar quando há muitos pedidos.

**2. Criar alerta de pedidos não enviados** (`src/components/expedition-beta/BetaOrdersList.tsx`)
- Adicionar um banner de alerta no topo da lista quando existirem pedidos com status `approved`, `picking`, `picked`, `packing` ou `packed` há mais de 2 dias (48h).
- O banner mostrará a quantidade de pedidos travados e há quantos dias o mais antigo está parado.
- Ao clicar, filtra automaticamente para mostrar apenas esses pedidos.

**3. Adicionar filtro "Atrasados"** (`src/components/expedition-beta/BetaOrdersList.tsx`)
- Nova aba de filtro "Atrasados" com ícone de alerta nos status tabs.
- Filtra pedidos não-despachados com `shopify_created_at` > 48h atrás.

Essas mudanças garantem que a equipe seja alertada visualmente sobre pedidos que estão demorando demais para serem enviados.

