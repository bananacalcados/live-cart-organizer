# Correção da atribuição de leads (Marketing > Leads)

Quatro correções, da origem do dado até o painel.

## 1. Área de membros só cria lead quando a pessoa é realmente nova (origem do dado)

Hoje a área de membros cria um lead `area_membros` para quase todo mundo que entra, inclusive quem já era lead de outro canal ou já era cliente. Auditoria: de 335 leads `area_membros`, 119 já eram lead de outro canal, 69 já eram lead de evento por outra origem e 63 já eram clientes com compra anterior — só 200 (60%) eram realmente novos.

Nova regra antes de inserir o lead:
- Já existe lead com o mesmo telefone (8 últimos dígitos) em qualquer origem, em `lp_leads` ou `event_leads`? Não cria — apenas registra a passagem pela área de membros nos metadados do lead original.
- Já é cliente com pelo menos uma compra anterior? Não cria lead.
- Nenhum dos dois? Cria normalmente com origem `area_membros` — é o caso do sorteio anunciado na live, e a venda futura dessa pessoa fica corretamente atribuída à área de membros.

Isso não muda nada no fluxo de confirmação do pedido nem no login da cliente; só deixa de gerar o registro duplicado.

## 2. Paginação com tratamento de erro (crítico)

`marketing-leads-dashboard` lê `lp_leads` (25k+ linhas) em blocos de 1000 usando `range()` sem ordenação e sem checar erro. Resultado: linhas puladas/repetidas e, quando um bloco falha, o painel mostra número parcial sem avisar — foi o que gerou o 0,27%.

- Adicionar ordenação estável (`created_at, id`) em todas as leituras paginadas.
- Checar erro de cada bloco; se algum falhar, abortar e devolver erro em vez de número parcial.
- O painel passa a exibir aviso quando a carga falha, em vez de renderizar dados incompletos.

## 3. Separar canal de aquisição de evento de fundo de funil (conceitual)

`area_membros` e `abandoned_cart` não são canais de aquisição — são momentos do funil. Depois da correção 1, `area_membros` passa a conter só lead novo de verdade e pode continuar na lista como canal.

- Manter `area_membros` como canal de aquisição (agora legítimo).
- Mover `abandoned_cart` para fora do ranking de aquisição, exibido em bloco separado de "eventos de funil".

## 4. Atribuição pela primeira captação de todos os tempos (menor)

Hoje o canal é definido pela primeira captação **dentro do período filtrado**. Quando a captação verdadeira aconteceu antes da janela, o canal muda (18 casos no período auditado).

- Passar a resolver o canal pela captação mais antiga já registrada para aquele telefone, independente do filtro de data.
- O filtro de período continua definindo quais leads/vendas entram na conta — só a origem deixa de ser recalculada pela janela.

## Detalhes técnicos

- `supabase/functions/live-member-area/index.ts` (bloco de lead em background, ~linhas 977-998): checagem cruzada por `phone_suffix8` em `lp_leads`, `event_leads` e `customers_unified` (`total_orders > 0` e `first_purchase_at` anterior) antes do insert.
- `supabase/functions/marketing-leads-dashboard/index.ts`: ordenação + verificação de erro na paginação, resolução de origem pela captação mais antiga, separação de `abandoned_cart`.
- `src/components/marketing/LeadsAnalyticsDashboard.tsx`: estado de erro visível e bloco separado de eventos de funil.
- Nenhuma migração de banco. Dados históricos de `area_membros` continuam como estão; se quiser, faço uma limpeza retroativa depois em passo separado.
