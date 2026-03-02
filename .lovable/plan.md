
# Migrar Expedição Beta de OAuth v3 para Token Fixo v2

## Problema
A Expedição Beta usa a API v3 do Tiny com OAuth, cujo refresh token expira apos ~30 dias de inatividade, exigindo reautenticacao manual. Isso cria uma manutencao recorrente inaceitavel.

## Solucao
Migrar a funcao `expedition-beta-initial-sync` para usar o token fixo `TINY_ERP_TOKEN` (API v2), que **nunca expira** e ja esta configurado como secret no projeto.

A API v2 do Tiny permite buscar pedidos por status e obter detalhes completos (itens, cliente, endereco), fornecendo os mesmos dados que a v3 fornece hoje.

## Mudancas

### Arquivo: `supabase/functions/expedition-beta-initial-sync/index.ts`

**Remover:**
- Funcao `getTinyV3Token()` (OAuth + refresh)
- Todas as chamadas a `TINY_V3_BASE` (`api.tiny.com.br/public-api/v3`)
- Dependencia de `app_settings.tiny_app_token`

**Adicionar:**
- Uso de `TINY_ERP_TOKEN` via `Deno.env.get()`
- Chamadas a API v2 do Tiny (`https://api.tiny.com.br/api2/pedidos.pesquisa.php` e `pedido.obter.php`)
- Mesma logica de mapeamento de dados (cliente, itens, status) adaptada para o formato de resposta v2

### Endpoints v2 utilizados

1. **Pesquisar pedidos**: `POST api2/pedidos.pesquisa.php` com `token`, `formato=json`, `situacao` (Aprovado/Enviado/etc)
2. **Obter detalhes**: `POST api2/pedido.obter.php` com `token`, `formato=json`, `id`

### Mapeamento de dados v2 para v3

O formato v2 retorna dados em estrutura ligeiramente diferente da v3. A funcao sera adaptada para:
- Extrair cliente de `pedido.cliente` (v2) em vez do objeto v3
- Extrair itens de `pedido.itens[].item` (v2) em vez do array v3
- Mapear situacoes por nome ("Aprovado", "Enviado", "Cancelado") em vez de IDs numericos
- Manter o mesmo schema de gravacao em `expedition_beta_orders` e `expedition_beta_order_items`

### Impacto
- **Zero mudanca no frontend** -- o componente `ExpeditionBeta.tsx` continua chamando a mesma funcao
- **Zero mudanca no banco** -- as tabelas permanecem identicas
- **Elimina completamente** a necessidade de reconexao OAuth
- O token v2 `TINY_ERP_TOKEN` ja esta configurado e funcionando para outras funcoes do sistema
