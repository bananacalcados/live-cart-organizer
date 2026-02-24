
# Plano: Melhorias no POS - Metas, Comissoes e Checkout por Loja

## Resumo das Solicitacoes

1. **Cor do premio**: Texto do premio nas metas deve ser preto para maior destaque
2. **Bug pontos fidelidade**: 0.1 pontos/R$ deveria dar 32 pts para R$320, mas esta dando 320
3. **Dados particulares do vendedor**: Acesso via PIN de 4 digitos no Dashboard com comissao acumulada, progresso de metas e bonus
4. **Sistema de metas escalonadas com comissao**: Metas por faixa de faturamento com % de comissao automatica por periodo
5. **Checkout proprio por loja** (discussao): Vendas online do POS criando pedido no Tiny da loja ao inves de enviar para Shopify

---

## 1. Cor do Premio (Rapido)

Alterar a classe CSS do texto de premio no componente `POSGoalProgress.tsx` de `text-yellow-400` para `text-black font-black` para dar mais destaque visual no tema claro.

---

## 2. Bug dos Pontos de Fidelidade

**Diagnostico**: A formula no `POSSalesView.tsx` linha 716 e:
```
Math.floor(totalWithDiscount * (loyaltyConfig.points_per_real || 0.1))
```

O banco confirma `points_per_real = 0.1`, mas o log mostra 319 pontos para R$319.99 (multiplicador de ~1). Isso indica que o `loyaltyConfig` nao estava carregado no momento da venda, e o fallback `|| 0.1` nao foi acionado porque o objeto existia mas o campo pode ter sido `undefined`.

**Correcao**: Garantir que o valor seja lido com seguranca:
```typescript
const rate = Number(loyaltyConfig?.points_per_real) || 0.1;
const points = Math.floor(totalWithDiscount * rate);
```

Adicionar tambem um log para depuracao e validacao.

---

## 3. Painel Privado do Vendedor (PIN 4 digitos)

### Banco de dados
- Adicionar coluna `pin_code VARCHAR(4)` na tabela `pos_sellers`
- Criar tabela `pos_seller_commissions` para registrar comissoes calculadas automaticamente

```text
pos_sellers
  + pin_code TEXT (4 digitos, nullable)

pos_seller_commission_tiers (NOVA)
  id, store_id, tier_order, min_revenue, max_revenue,
  commission_percent, period (monthly/custom),
  period_start, period_end, is_active, created_at

pos_seller_commissions (NOVA)
  id, store_id, seller_id, period_start, period_end,
  total_revenue, tier_id, commission_percent,
  commission_value, bonus_value, status (pending/paid),
  created_at
```

### Frontend - Dashboard
- Adicionar botao "Meus Dados" na secao de Desempenho por Vendedor
- Ao clicar, abrir dialog pedindo PIN de 4 digitos
- Apos autenticacao, exibir painel privado com:
  - Faturamento total do vendedor no periodo
  - % da meta individual atingida
  - Comissao acumulada em R$
  - Quanto falta para a proxima faixa de comissao
  - Bonus ja conquistados
  - Historico resumido

### Frontend - Config
- Campo para definir PIN de cada vendedor na aba Config
- Secao para criar faixas de comissao escalonadas (ex: ate R$10k = 1%, R$10k-20k = 1.5%, acima de R$20k = 2%)

---

## 4. Metas Escalonadas com Comissao Automatica

O sistema atual de metas (`pos_goals`) ja suporta metas por vendedor e por periodo. A novidade e o **escalonamento de comissao**:

- Tabela `pos_seller_commission_tiers` permite configurar faixas progressivas
- Exemplo: Vendedora que fatura R$15.000 no mes:
  - Faixa 1: Ate R$10.000 = 1% = R$100
  - Faixa 2: R$10.001 a R$20.000 = 1.5% = R$75
  - **Total comissao: R$175**
- O calculo e feito automaticamente ao consultar os dados no painel privado
- A comissao pode ser registrada com status "pendente" ate ser marcada como "paga"

---

## 5. Checkout Proprio por Loja (Discussao)

**Sua ideia faz total sentido!** A separacao e a abordagem correta:

- **Checkout atual** (`/checkout-transparente`): Continua servindo eventos online, criando pedidos na Shopify
- **Novo checkout por loja** (`/checkout-loja/:storeId`): Rota dedicada que cria o pedido diretamente no Tiny ERP da loja correspondente

**Vantagens**:
- Nao mexe na estrutura existente dos eventos
- Cada loja tem seu checkout com token Tiny proprio
- Vendas online do POS vao direto pro Tiny da loja (sem passar pela Shopify)
- Links de pagamento gerados no modulo "Online" do POS apontam para esse novo checkout

**Implementacao proposta**:
- Clonar a logica do checkout transparente em uma nova rota
- No momento do pagamento confirmado, chamar `pos-tiny-create-sale` ao inves de `shopify-create-order`
- O `storeId` na URL determina qual token Tiny usar

> **Nota**: Essa parte e mais complexa e pode ser feita em uma etapa separada. Recomendo priorizar os itens 1-4 primeiro.

---

## Sequencia de Implementacao

1. Corrigir cor do premio (1 minuto)
2. Corrigir bug dos pontos de fidelidade (5 minutos)
3. Migracoes do banco (novas tabelas e colunas)
4. Config: PIN dos vendedores + faixas de comissao
5. Dashboard: painel privado com PIN
6. Checkout por loja (etapa futura)

## Detalhes Tecnicos

### Arquivos a modificar:
- `src/components/pos/POSGoalProgress.tsx` - cor do premio
- `src/components/pos/POSSalesView.tsx` - fix formula de pontos
- `src/components/pos/POSDashboard.tsx` - botao "Meus Dados" + dialog PIN + painel privado
- `src/components/pos/POSConfig.tsx` - campo PIN por vendedor + faixas de comissao

### Novas migracoes SQL:
- ALTER TABLE pos_sellers ADD COLUMN pin_code TEXT
- CREATE TABLE pos_seller_commission_tiers
- CREATE TABLE pos_seller_commissions
