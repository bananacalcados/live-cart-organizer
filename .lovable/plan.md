# Públicos Meta sincronizados automaticamente pelo ERP

## 0. Resultado da auditoria do token (feita agora, só leitura)

- Token usado nos gastos de anúncios: válido, **token de usuário (Carolina Aguiar)**, não é usuário de sistema. Vence em **29/11/2026**. A rotina diária de anúncios já renova e guarda a versão nova no cofre; a sincronização de públicos vai ler do mesmo lugar.
- Permissões: **tem `ads_management` e `ads_read`**. Serve para escrever nos públicos, sem token novo.
- Termos de Público Personalizado da conta `act_2253897104825255`: **aceitos** (conta e usuário).
- Tokens do CAPI/offline: só servem para o pixel, não leem nem escrevem públicos. Não serão usados.
- Risco: se a Carolina sair do Business Manager ou trocar a senha, o token para. Recomendação para depois (não bloqueia): criar um usuário de sistema no Business Manager com `ads_management` na conta. Hoje não precisa fazer nada.

## 1. Públicos existentes (atualizar no lugar, nunca apagar)

| Público | Hoje na Meta | Regra | Estimativa ERP |
|---|---|---|---|
| compradores_live_90d | ~1.000 | pedido de live pago nos últimos 90d | 1.415 |
| compradores-online-desde-mar2026 | 1,0–1,2 mil | live/WhatsApp/site pagos desde 01/03 | 2.611 |
| compradores-loja-fisica-desde-mar2026 | 1,3–1,6 mil | venda presencial desde 01/03 | 1.714 |
| compradores_loja_180d | 1,9–2,2 mil | venda presencial últimos 180d | 1.714 |
| leads-que-nunca-compraram | 13,8–16,2 mil | leads sem nenhuma compra | 11.428 |
| todos-os-clientes-base | 26,2–30,9 mil | qualquer compra, todas as fontes | ~20.000 (base unificada) |

Contagens = pessoas únicas pelo telefone (DDD + 8 últimos). A Meta mostra só quantas ela conseguiu casar, então o número dela será menor.

Os dois "estranhos":
- **Clientes Março a 19 Setembro** (2,4–2,8 mil): lista feita à mão em 20/09 com compradores de mar a 19/set. É a base do "Semelhante 1%". Proposta: **manter congelada** (mexer nela muda o semelhante usado nas campanhas).
- **audiencia_meta_banana.csv** (14,3–16,8 mil, de 02/05): lista antiga, base de dois semelhantes. Proposta: **manter congelada** também; o "todos-os-clientes-base" já cobre a mesma ideia atualizada.

## 2. Públicos novos ("ERP –")

| Público | Regra | Estimativa |
|---|---|---|
| ERP – Compraram últimos 7 dias | qualquer compra paga em 7d (para exclusão) | ~335 |
| ERP – Incompletos última live | pedidos "incompleto" do último evento | 7 pedidos (ver pergunta 3) |
| ERP – Pediram e não pagaram 14d | pedido criado em 14d, não pago, sem compra no período | 112 |
| ERP – Clientes sem compra 60–180d | última compra entre 60 e 180 dias | ~2.000–2.200 |
| ERP – Grupos VIP membros | membros ativos (não internos) de grupos VIP | 5.729 |

Públicos abaixo de 100 pessoas casadas não entregam anúncio; os pequenos servem mais para exclusão.

## 3. Como vai funcionar

- Cadastro de cada público (id na Meta, nome, regra, ligado/desligado, última sincronização, quantos entraram/saíram, último erro).
- Lista de quem está em cada público hoje no ERP; a cada rodada compara com o critério: **adiciona só quem entrou, remove só quem saiu**.
- Dados enviados com hash SHA-256 e a mesma normalização do CAPI: telefone, e-mail, nome, sobrenome, cidade, estado, CEP, país. CPF nunca vai.
- Lotes de até 10.000; tentativas com espera crescente; erros da Meta guardados.
- Horários: todo dia 03:00 BRT; em dia de live, também 10:00 e 12:00. Sem cron de minuto.
- Tela **Marketing > Públicos Meta**: status por público (contagem ERP, contagem aproximada na Meta, última sincronização, erros) e botão "Sincronizar agora" (só admin).
- Primeira carga: a Meta recomenda trocar a lista inteira de uma vez (sessão de substituição). Uso isso na primeira rodada dos públicos CSV, porque eles têm gente que o ERP não sabe que está lá; depois disso, só diferenças.
- Recusa de publicidade: quem recusou não entra em nenhum público e é removido se já estiver (hoje são 2 recusas).

## 4. Riscos

- **Remoção indevida**: se uma regra quebrar e devolver zero ou muito menos, o sistema esvaziaria o público. Trava: se a rodada for remover mais de 20% do público (ou o critério vier vazio), para, não remove e mostra alerta.
- **Primeira carga com substituição**: quem estava no CSV e não está no ERP sai. No "todos-os-clientes-base" a lista cai de ~26 mil para ~20 mil; nos outros sobe.
- **Mudança de público ativo**: a Meta pode reiniciar o aprendizado dos conjuntos que usam esse público e dos semelhantes ligados a ele.
- **Limites da API**: cada lote conta no limite de chamadas da conta; com ~30 mil pessoas no total são poucas chamadas por dia. Em erro de limite, espera e tenta de novo uma vez.
- **Token de usuário** (ver item 0).
- **Banco**: as listas são montadas no servidor em lotes, de madrugada, sem varrer tabelas grandes de mensagens.

## 5. Perguntas

1. Os dois públicos antigos (Março a 19 Setembro e audiencia_meta_banana): **manter congelados**? 
2. Primeira carga: posso **substituir a lista inteira** nos 6 públicos existentes (quem não está no ERP sai), ou prefere só adicionar e nunca tirar quem veio do CSV?
3. "Incompletos última live": "última live" = o evento mais recente que teve pedido, mesmo que ainda esteja acontecendo? (Encontrei 7 pedidos nessa etapa no último evento; vou confirmar o telefone deles na implementação.)
4. "todos-os-clientes-base": usar a base unificada de clientes (inclui compras antigas importadas, ~20 mil) ou só compras registradas no sistema (~4.200)?
5. Leads: além dos leads de evento, entram leads de captação/landing pages e membros de grupo que nunca compraram?

## Detalhes técnicos

- Nova migração: tabelas `meta_audience_definitions` e `meta_audience_members` (audience_id, phone_key, hash, status, since), com GRANT/RLS só admin + service_role; RPCs por regra com paginação por cursor (máx. 10 mil por página).
- Nova edge function `meta-audience-sync` (cron 03:00 BRT; 10:00/12:00 só quando houver evento ativo no dia, checado pela própria função): token via `meta_ads_get_token` com fallback ao secret; POST/DELETE `/{id}/users` com `schema` multi-chave; `session` para substituição na 1ª carga; guarda de 20%.
- Reaproveitar a normalização/hash do `meta-capi-event` movendo-a para `_shared/meta-hash.ts`.
- Front: `src/pages/marketing/MetaAudiences.tsx` + item no menu de Marketing; teste unitário da diferença (entrou/saiu) e da trava de 20%.
- Registrar a regra no AGENTS.md.
