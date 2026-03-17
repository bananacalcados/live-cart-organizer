
Objetivo: corrigir a origem das duplicações no módulo Eventos/Live e criar um fluxo seguro para tratar os pedidos já duplicados na Shopify sem cancelar compras legítimas do mesmo cliente.

1. Diagnóstico do problema atual
- A função `shopify-create-live-order` hoje tenta deduplicar consultando pedidos recentes na Shopify, mas isso não é atômico. Se 2 acionamentos chegarem quase ao mesmo tempo, os 2 podem passar na checagem e criar 2 pedidos.
- O botão manual “Criar na Shopify” em `LiveSessionManager.tsx` chama a mesma função sem `sessionId` nem `dedupeKey`. Isso enfraquece a deduplicação e explica casos em que um pedido vai com nome completo e outro com `@instagram`: os dados enviados não são consistentes entre os gatilhos.
- Hoje não existe um vínculo persistente e confiável entre “pedido/live local” e “pedido Shopify criado”. Isso dificulta revisar duplicados antigos e agir com segurança.

2. Como vou corrigir para não voltar a acontecer
- Criar uma trava de idempotência no backend com chave única por compra live.
- Fazer todos os gatilhos usarem a mesma chave estável:
  - `sessionId` da live
  - telefone/e-mail/CPF normalizados
  - assinatura exata dos itens: variante + quantidade + preço
- Ajustar o botão manual da live para enviar os mesmos identificadores do checkout automático, em vez de depender só de nome/telefone.
- Persistir um registro local do resultado da sincronização com Shopify:
  - chave de dedupe
  - origem do disparo
  - dados normalizados do cliente
  - assinatura dos itens
  - `shopify_order_id` / `shopify_order_name`
  - status da tentativa
- Manter a checagem de pedidos recentes na Shopify como camada extra, mas não como defesa principal.

3. Como vou tratar os pedidos que já foram duplicados
Você escolheu “Revisar antes”, então não vou cancelar em massa automaticamente.

Vou criar um fluxo de revisão que:
- busca pedidos live já criados na Shopify
- agrupa por identidade estável do cliente:
  - CPF, ou
  - telefone normalizado, ou
  - e-mail normalizado
- compara a assinatura exata dos itens:
  - mesma variante/produto
  - mesma quantidade
  - mesmo preço
- sinaliza como “candidato a duplicado” apenas quando houver correspondência exata dos itens

Isso preserva compras reais do mesmo cliente:
- se ele comprou duas vezes, mas com itens diferentes, não entra como duplicado
- se comprou duas vezes exatamente a mesma coisa, entra para revisão humana, não para cancelamento automático

4. Fluxo de revisão/cancelamento que vou implementar
- Adicionar uma tela/painel de “Revisão de duplicados Shopify” no módulo de Eventos/Live.
- Cada grupo suspeito mostrará:
  - cliente
  - telefone/e-mail/CPF normalizados
  - pedidos Shopify envolvidos
  - horário de criação
  - produtos/quantidades/preços
  - origem detectada
  - qual pedido parece ser o “principal” e quais parecem duplicados
- A ação será individual:
  - manter pedido principal
  - cancelar somente os duplicados selecionados
- Após cancelar:
  - registrar auditoria local
  - atualizar o status local de sincronização
  - refletir isso nas verificações e badges de Shopify

5. Como o cancelamento será feito
- Sim, eu consigo cancelar na Shopify.
- Vou implementar uma função backend protegida para cancelar pedidos selecionados via API da Shopify.
- Esse cancelamento será sempre manual por item revisado, nunca automático para todos os suspeitos.
- Também vou registrar o resultado localmente para evitar tentar cancelar o mesmo pedido duas vezes e para manter histórico.

6. Mudanças técnicas planejadas
Arquivos existentes a ajustar:
- `supabase/functions/shopify-create-live-order/index.ts`
- `src/pages/TransparentCheckout.tsx`
- `src/components/LiveSessionManager.tsx`
- `supabase/functions/shopify-verify-event-orders/index.ts` ou uma nova função específica de revisão

Novos elementos backend:
- tabela de idempotência/trava única para pedidos live
- tabela de vínculo/auditoria entre compra live e pedido Shopify
- função backend para listar candidatos a duplicado
- função backend para cancelar pedido Shopify selecionado
- políticas RLS adequadas e acesso restrito a usuários autenticados autorizados

7. Regra de decisão para duplicado
Vou usar esta lógica:
- duplicado forte:
  - mesmo `sessionId` ou mesma identidade normalizada do cliente
  - mesma assinatura exata dos itens
  - criado em janela curta
- compra legítima repetida:
  - mesmo cliente, mas itens diferentes
  - ou mesmo cliente, mesmo dia, porém assinatura diferente
- caso ambíguo:
  - aparece para revisão, não para cancelamento automático

8. Resultado esperado
- novos pedidos pagos da live deixam de duplicar
- diferença entre nome completo e `@instagram` deixa de gerar pedido duplicado
- pedidos antigos duplicados passam a aparecer numa revisão segura
- você poderá cancelar só os realmente duplicados, sem arriscar cancelar compras reais repetidas do mesmo cliente

9. Observações importantes
- Não vou confiar em nome para deduplicação, porque ele varia entre checkout e painel manual.
- A correção principal será feita no backend, porque só frontend não resolve condição de corrida.
- Como hoje o vínculo local com Shopify é fraco para pedidos antigos, a primeira revisão vai depender de comparação por identidade normalizada + itens exatos.

Se eu implementar isso, o fluxo ficará dividido em duas frentes:
1) prevenção definitiva dos novos duplicados
2) painel de revisão para cancelar os duplicados já criados com segurança
