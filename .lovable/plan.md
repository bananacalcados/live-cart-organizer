## Objetivo

Tornar `customers_unified` a **fonte única e confiável** da matriz RFM: sem duplicatas, com histórico antigo (Zoppy/Excel) preservado **e** vendas novas do PDV somadas sem dobrar, e a aba Marketing → Clientes RFM passa a ler dela (só compradores).

## Diagnóstico que motiva o plano (já confirmado no banco)

- `customers_unified` tem ~40 mil **cópias duplicadas** de clientes da Zoppy que perderam contato no import (escapam da dedup por não terem CPF/telefone).
- O import para a unificada **perdeu ~6 mil telefones** que existem na `zoppy_customers` (tabela curada: 26 mil compradores, 24 mil com telefone, sem duplicata por CPF/telefone).
- `recalc_customer_metrics` conta **só `pos_sales`** e **sobrescreve** os totais históricos importados sempre que entra uma venda nova — misturando dois modelos incompatíveis.

## Plano (executado em ondas, validando os números a cada onda)

### Onda 1 — Preparar a base (migração, aditiva e reversível)
Adicionar à `customers_unified`:
- `legacy_orders`, `legacy_spent`, `legacy_first_purchase_at`, `legacy_last_purchase_at` — histórico **congelado** (Zoppy/Excel).
- `merged_into_id` — aponta para o cadastro sobrevivente quando a linha for duplicata.
- `is_archived` — exclui da matriz (sem apagar nada).

### Onda 2 — Congelar o histórico
- Preencher `legacy_*` a partir da `zoppy_customers` (mapeando pela origem `zoppy:<id>` → `zoppy_customers.id`) e, para imports sem origem Zoppy, a partir dos totais importados atuais de linhas que não têm `pos_sales`.
- Isso recupera o histórico antes que qualquer recálculo o sobrescreva.

### Onda 3 — Enriquecer contato
- Copiar telefone/CPF/e-mail da `zoppy_customers` para a unificada onde estiver faltando (recupera os ~6 mil telefones perdidos), respeitando a regra de identidade por CPF (não injeta CPF de terceiro).

### Onda 4 — Mesclar duplicatas
- Agrupar linhas da mesma pessoa por: mesma origem `zoppy:<id>`, mesmo CPF, ou mesmo telefone (DDD + 8 dígitos).
- Eleger 1 **sobrevivente** por grupo (o mais completo: com telefone > com CPF > maior histórico).
- **Repontar** todas as referências (`orders`, `pos_sales`, `customer_list_memberships`) para o sobrevivente.
- Consolidar `legacy_*` no sobrevivente (cópias idênticas ⇒ usa o maior, não soma) e marcar as demais com `merged_into_id` + `is_archived = true`.
- Registrar tudo em `master_merge_log` (reversível).

### Onda 5 — Novo modelo de métricas (migração)
Reescrever `recalc_customer_metrics` para:
- `total_orders = legacy_orders + (vendas do PDV mais novas que `legacy_last_purchase_at`)`
- `total_spent  = legacy_spent  + (valor dessas vendas novas)`
- Sem `legacy` (cliente 100% novo) ⇒ conta todas as `pos_sales`.
- Regra do recorte evita **dobrar** pedidos antigos da Shopify/Tiny que já estão no histórico importado.
- Recalcular RFM consolidado na unificada.

### Onda 6 — Trocar a tela
- Aba Marketing → Clientes RFM passa a ler `customers_unified` com `is_archived = false` e `total_orders >= 1` (só compradores), mapeando os nomes de coluna (`rfm_r/f/m/total/segment`).
- Validar contagem final por segmento contra a expectativa (~26 mil compradores reais).

## Detalhes técnicos / pontos de atenção

- **Sobrescrita evitada:** hoje o trigger `trg_pos_sales_recalc_after` já chama `recalc_customer_metrics`; após a Onda 5 ele passa a somar `legacy + novo` em vez de zerar o histórico.
- **Triggers de venda intactos:** estoque/CAPI/automação/caixa continuam guardados por status; nenhuma das ondas altera valor, estoque ou caixa.
- **Dedup intra-`pos_sales` (Live × Shopify devolvida):** a venda de Live (linha PDV) e o pedido que volta da Shopify podem gerar 2 linhas em `pos_sales`. O recorte por data não resolve isso sozinho; trato como item separado após a Onda 6 (medir sobreposição real por cliente+valor+janela antes de definir regra), para não atrasar a correção principal.
- **Reversibilidade:** nada é apagado — duplicatas ficam com `merged_into_id`/`is_archived`; `master_merge_log` guarda o de-para.
- **Validação:** ao fim de cada onda eu rodo contagens (compradores, com contato, duplicados restantes, soma de faturamento) e te apresento antes de seguir.
