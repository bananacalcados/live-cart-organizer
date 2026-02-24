

## Plano: Correcao de Estoque da Troca + Melhorias no POS

### 1. Correcao Manual do Estoque da Troca no Centro

A troca `6c33510b` na Loja Centro processou estoque incorretamente. Para corrigir, vou invocar a Edge Function `pos-exchange-stock-adjust` com os dados corretos dos 3 produtos envolvidos:

- **1444.105 TENIS LETICIA (tiny_id: 761752353)**: Voltou para o estoque (direction: "in", qty: 1)
- **508069 RASTEIRA ZARA (tiny_id: 755331396)**: Saiu do estoque (direction: "out", qty: 1)
- **27507 CHINELO IPANEMA PLUMA (tiny_id: 755431377)**: Saiu do estoque (direction: "out", qty: 1)

A Edge Function ja esta com a logica correta de Balanco (tipo B) com deposito "Centro". Vou chamar a funcao novamente para reprocessar o ajuste com os saldos atuais do Tiny.

**Acao**: Invocar `pos-exchange-stock-adjust` via curl com os 3 itens e store_id da Loja Centro.

### 2. Detalhes do Pedido Tiny - Dialog Melhorado

Atualmente os pedidos encontrados apenas no Tiny (resultados roxos) nao sao clicaveis. Vou:

- Tornar os cards de pedido Tiny clicaveis
- Ao clicar, buscar detalhes completos do pedido no Tiny via a Edge Function `pos-tiny-search-orders` (adicionando um modo "detail" que busca `pedido.obter.php`)
- Exibir um Dialog com: produtos, endereco do cliente, CPF, telefone, forma de pagamento, etc.

### 3. Redesign Visual do Dialog de Detalhes do Pedido

O dialog atual (`POSSaleDetailDialog.tsx`) tem fundo escuro (`bg-[#1a1a2e]`) com bordas laranja fraca que nao contrasta. Vou redesenhar:

- Fundo claro (`bg-white`) com texto escuro para maximo contraste
- Secoes com fundo colorido sutil (laranja claro para header, azul claro para cliente, etc.)
- Badges com cores mais vibrantes e legibilidade
- Tipografia mais forte com hierarquia visual clara
- Cards de produto com fundo branco e bordas mais marcadas
- Area de pagamento com destaque verde para o total

### 4. Mais Contraste no POS Geral

Aplicar melhorias de contraste nos componentes do POS:
- Cards de venda: bordas mais visíveis, texto mais legível
- KPIs: cores mais vibrantes nos valores
- Badges de status: cores mais fortes e saturadas

### 5. Transferencia de Estoque Automatica ao Confirmar Solicitacao

Atualmente o ajuste de estoque so acontece quando o status muda para "delivered". O usuario quer que a transferencia no Tiny ocorra quando a **loja que recebeu a solicitacao confirma** (status "confirmed").

**Mudanca em `POSInterStoreRequests.tsx`**:
- Mover a logica de chamada `pos-inter-store-stock-transfer` do bloco `if (responseStatus === "delivered")` para `if (responseStatus === "confirmed")`
- Isso faz o balanco automatico no Tiny no momento da confirmacao
- O botao "Confirmar Recebimento" (quando a solicitacao chega fisicamente) apenas atualiza o status local sem mexer no estoque novamente

### Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| `src/components/pos/POSSaleDetailDialog.tsx` | Redesign visual com cores claras e alto contraste |
| `src/components/pos/POSDailySales.tsx` | Tornar pedidos Tiny clicaveis + mais contraste nos cards |
| `src/components/pos/POSInterStoreRequests.tsx` | Mover transferencia de estoque para o momento da confirmacao |
| `supabase/functions/pos-tiny-search-orders/index.ts` | Adicionar modo "detail" para buscar detalhes completos de um pedido Tiny |

Nenhuma migracao SQL necessaria.

