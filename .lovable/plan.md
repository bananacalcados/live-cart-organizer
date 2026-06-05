# Plano completo — PDV, Clientes Unificados e Expedição Beta

Antes de tudo, o diagnóstico-chave: **já existe a tabela unificada de clientes** que você deseja — ela se chama `customers_unified` (87.784 clientes) e já junta automaticamente clientes do Marketing (zoppy/Clientes 360), do PDV (`pos_customers`), do checkout (`customer_registrations`) e de campanhas. O cliente Matthews (CPF 150.231.397-94, registro "Rafael Silva de Jesus") **já está nela**. O problema é que o PDV (aba Cliente 360 e aba Clientes) busca **apenas** em `pos_customers`, que é menor.

Recomendação técnica: manter `customers_unified` como a **fonte de leitura/busca** de TODOS os módulos (ela já agrega tudo), e usar `pos_customers` como tabela **transacional** (onde existe a chave estrangeira das vendas, trocas, condicionais). Quando um cliente é selecionado para uma venda/ação, ele é "materializado" em `pos_customers`. Assim você nunca quebra as vendas existentes e ainda enxerga 100% dos clientes.

Vou dividir em **6 etapas independentes**, cada uma testável isoladamente.

---

## Etapa 1 — Corrigir forma de pagamento "VPS" (rápida, sem risco)
A lista de formas de pagamento do PDV vem da tabela `pos_payment_methods` (espelho do Tiny). "VPS" não existe lá, por isso não aparece.
- Adicionar "VPS" como método ativo em `pos_payment_methods` para as lojas.
- O resto do sistema (dashboard, modal de vendas) já reconhece "VPS" — só falta cadastrar.

## Etapa 2 — Busca de clientes unificada no PDV (Cliente 360 + materialização)
Trocar a fonte de busca de `pos_customers` para `customers_unified` no `POSCustomer360` e na função de busca de vendas (`POSSalesView`).
- Busca por CPF, telefone (sufixo 8 dígitos), nome ou email passa a achar **todos** os clientes, independente de loja ou origem de cadastro (resolve o caso do Matthews).
- Ao selecionar um cliente que ainda não existe em `pos_customers`, materializar automaticamente (criar o registro com CPF/whatsapp/endereço) para a venda/NF-e funcionar — lógica de dedup por CPF normalizado.

## Etapa 3 — Aba "Clientes" do PDV: paginada + filtros + WhatsApp
Reformular a aba Clientes para listar clientes recentes (lendo de `customers_unified`), com:
- **Paginação** (ex.: 30 por página) para não pesar.
- **Filtros**: loja, vendedor, ticket médio (faixas), data de última compra.
- **Busca** por CPF/telefone/nome/email achando todos os clientes.
- **Botão "Enviar WhatsApp"** no cliente, reaproveitando o seletor de instância ONLINE já criado (NewConversationDialog), enviando pela instância escolhida (provedor derivado automaticamente).

## Etapa 4 — Sincronizar checkout/links de pagamento → `pos_customers`
Garantir que clientes do checkout/link de pagamento entrem em `pos_customers`:
- Criar trigger que espelha `customer_registrations` → `pos_customers` (dedup por CPF; atualiza endereço/whatsapp se já existir).
- No fluxo de pagamento por link, ao confirmar pagamento, casar pelo CPF um cliente já existente e vincular a venda a ele (sem criar duplicado).
- Backfill único dos registros de checkout existentes que ainda não têm correspondente no PDV.

## Etapa 5 — Aba "Envios" na Expedição Beta (antes de Suporte)
Nova aba **Envios** posicionada antes de **Suporte**, com a lista de todos os envios já realizados (status despachado/entregue), mostrando nome, endereço, código de rastreio, método de envio e data.
- **Paginação** server-side (ex.: 25 por página) para carregamento leve.
- **Filtros**: dia, semana, mês e período personalizado.
- Leitura de `expedition_beta_orders` (já tem `tracking_code`, `shipping_address`, `customer_name`).

## Etapa 6 — Migrar fonte da Expedição Beta: Tiny → Shopify
Hoje `expedition-beta-initial-sync` puxa do Tiny (`api.tiny.com.br`). Migrar para puxar pedidos direto da **Shopify** (API de Orders), mantendo o mesmo formato de `expedition_beta_orders` para não quebrar as telas.
- Reescrever a sincronização para ler pedidos pagos/abertos da Shopify (status financeiro e de fulfillment), mapeando para `expedition_status`.
- Trazer rastreio da Shopify quando disponível (fulfillment tracking).
- Por ser a etapa de maior risco, fica por último e será testada isoladamente antes de desligar o caminho do Tiny.

---

## Observações importantes
- **`pos_customers` definitiva**: para os módulos PDV/Eventos/Expedição/Marketing, a busca passa a enxergar tudo via `customers_unified`, e `pos_customers` recebe os clientes materializados — efetivamente vira a base operacional única, sem quebrar as FKs de vendas existentes.
- **Clientes Shopify**: já vão para `pos_customers` via `shopify-sync-to-pos` (dedup por CPF/whatsapp). Vou confirmar/garantir isso na Etapa 4.
- **Clientes 360 do Marketing**: continua usando a mesma base unificada — fica consistente com o PDV.
- Nada nesta sequência altera/exclui dados existentes de forma destrutiva; são adições e troca de fonte de leitura.

## Pergunta antes de começar
Sobre o **VPS**: ele deve aparecer nas **duas lojas** (Centro e a outra) e como forma à vista (sem parcelas), igual Dinheiro/Pix? Confirmando isso, começo pela Etapa 1 imediatamente.
