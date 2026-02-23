
# Plano: Integrar Cotacao de Frete via Tiny ERP

## Problema Atual

O sistema cota frete diretamente pela Frenet, mas o Tiny ERP tambem esta conectado a Frenet internamente. Isso causa:

1. Os codigos de servico do Tiny nao batem com os da Frenet direta -- erro "forma de frete vazio"
2. O contrato empresarial dos Correios configurado no Tiny nao e utilizado (precos piores)
3. Peso sendo interpretado incorretamente (700g virando 700kg)
4. Mapeamento manual de carrier para codigos Tiny e fragil e propenso a erros

## Solucao Proposta

Usar a API do Tiny para buscar as **formas de envio** e **formas de frete** reais cadastradas na conta, e armazenar os IDs do Tiny junto com cada cotacao. Assim, na hora de gerar etiqueta, usamos os IDs exatos que o Tiny reconhece.

### Fluxo Novo (Hibrido)

```text
1. Cotar Frete (botao)
   |
   v
2. Edge Function busca formas de envio do Tiny
   (formas.envio.pesquisa.php + formas.envio.obter.php)
   |
   v
3. Tambem cota via Frenet (precos em tempo real)
   |
   v
4. Cruza: para cada cotacao Frenet, encontra o ID
   da forma de frete correspondente no Tiny
   |
   v
5. Salva cotacoes com tiny_forma_envio_id + tiny_forma_frete_id
   |
   v
6. Usuario seleciona -> salva IDs no pedido
   |
   v
7. Na emissao de NF-e e geracao de etiqueta,
   usa os IDs do Tiny diretamente (sem mapeamento manual)
```

## Etapas de Implementacao

### Etapa 1: Adicionar colunas para IDs do Tiny

Adicionar colunas na tabela `expedition_freight_quotes` e `expedition_orders` para armazenar os IDs reais do Tiny:

- `expedition_freight_quotes`: `tiny_forma_envio_id`, `tiny_forma_frete_id`, `tiny_service_code`
- `expedition_orders`: `tiny_forma_envio_id`, `tiny_forma_frete_id`, `tiny_service_code`

### Etapa 2: Reescrever `expedition-quote-freight`

A Edge Function passara a:

1. Chamar `formas.envio.pesquisa.php` do Tiny para listar todas as formas de envio cadastradas (Correios, J&T, etc.)
2. Para cada forma de envio, chamar `formas.envio.obter.php` para obter as formas de frete (PAC, SEDEX, etc.) com seus IDs
3. Continuar cotando via Frenet para obter precos e prazos em tempo real
4. Cruzar os resultados: associar cada cotacao Frenet com o ID correto da forma de frete no Tiny
5. Salvar as cotacoes com `tiny_forma_envio_id` e `tiny_forma_frete_id`
6. Manter a opcao "Mototaxista" como fallback manual

### Etapa 3: Atualizar selecao de frete no frontend

Quando o usuario selecionar um frete em `ExpeditionFreightQuote.tsx`, salvar tambem os IDs do Tiny no `expedition_orders`.

### Etapa 4: Simplificar `expedition-tiny-invoice` e `expedition-fetch-label`

Remover todo o mapeamento manual de carrier (as funcoes `mapCarrierToFormaEnvio` e `mapToServiceCode`). Em vez disso, usar diretamente os IDs armazenados:

- Na NF-e: usar `tiny_forma_envio_id` e `tiny_forma_frete_id` no payload
- Na etiqueta: usar os mesmos IDs ao atualizar o pedido de venda e a expedicao

Isso elimina o problema de "forma de frete vazio" e garante que o Tiny reconheca o servico selecionado.

### Etapa 5: Correcao de peso

Garantir que TODOS os pontos que enviam peso ao Tiny facam a conversao `total_weight_grams / 1000` com minimo de 0.3 kg. Revisar `expedition-tiny-invoice` e `expedition-fetch-label`.

## Arquivos Modificados

| Arquivo | Alteracao |
|---|---|
| Migracao SQL (nova) | Adicionar colunas `tiny_forma_envio_id`, `tiny_forma_frete_id`, `tiny_service_code` nas tabelas |
| `supabase/functions/expedition-quote-freight/index.ts` | Reescrever para buscar formas de envio do Tiny + cruzar com Frenet |
| `src/components/expedition/ExpeditionFreightQuote.tsx` | Salvar IDs do Tiny ao selecionar frete |
| `supabase/functions/expedition-tiny-invoice/index.ts` | Usar IDs do Tiny em vez de mapeamento manual |
| `supabase/functions/expedition-fetch-label/index.ts` | Usar IDs do Tiny em vez de mapeamento manual; remover `mapCarrierToFormaEnvio` e `mapToServiceCode` |

## Resultado Esperado

- Cotacoes com precos do contrato empresarial dos Correios (via Frenet configurada no Tiny)
- IDs exatos do Tiny em cada etapa -- sem mapeamento manual
- Eliminacao do erro "forma de frete vazio" na geracao de etiquetas
- Peso sempre em kg correto (nunca mais 700kg)
