# Lentidão na live 31/10 — diagnóstico e correção mínima

## Medição (preview, sessão real, evento LIVE SITE 31/10, 60 s por tela, só leitura)

| Tela | Req/min | Baixado/min | Travamento da tela | Memória | Elementos na página |
|---|---|---|---|---|---|
| Quadro do evento (Kanban) | **1.144** | 1,0 MB | **20 s travados em 60 s** (85 travadas, 24 > 200 ms, pior 1,5 s) | 380 → 285 MB | **55 mil** |
| Central da Live | 262 | 0,9 MB | **30 s travados em 60 s** (26 > 200 ms, pior 1,4 s) | **702 → 846 MB (subindo)** | 55 mil |
| PDV WhatsApp | 125 | **32 MB** | 4,7 s (nenhuma > 200 ms) | 72 → 105 MB | 5 mil |

Mais repetidas no Kanban (por minuto): ficha do cliente 145x, mensagens 137x, último cadastro 134x, evento 132x, etiquetas 127x + 127x, prêmios 112x, expedição 81x (busca por final de telefone com "contém"), tentativas de checkout 32x (288 KB). São consultas **por cartão**, e se repetem ~1x por minuto para cada um dos ~130 cartões. No mesmo minuto foram criados **134 temporizadores de 60 s** — sinal de que os cartões estão sendo desmontados e remontados, refazendo tudo.

PDV WhatsApp: a lista de conversas completa veio **11x em 60 s, 2,5 MB cada (27 MB/min)**.

Não consegui medir: canais em tempo real abertos e eventos/min por tabela (o interceptador não capturou a conexão), e a data da última publicação (não tenho como ler). Hoje foram alteradas: a janela do evento (catálogo no Crossell), o cartão do pedido (selo do catálogo), o chat do pedido (bloco de convite), página pública do catálogo, funções do catálogo/convite e o agendamento do convite por minuto. Nada disso entrou no Kanban/PDV em volume medido — as consultas pesadas acima são antigas. O cron do convite não aparece no navegador.

## Veredito — 3 causas, em ordem

1. **Cartões do Kanban/Central remontando todo minuto (N consultas por cartão).** ~1.100 req/min e 20–30 s de travamento por minuto, 55 mil elementos. Mesmo com o banco ocioso, o navegador do vendedor trava. Correção mínima (exige publicar): o cartão não refazer as buscas a cada atualização — depender só de id/telefone, buscar ficha/etiquetas/prêmios/tentativas em lote uma vez para o quadro inteiro, e achar o motivo do remonte (chave do cartão ou recarga do quadro) para estabilizar. Remédio imediato sem publicar: vendedores usarem "Minimizar quadro de pedidos" e manterem a Central desligada quando não precisarem.
2. **Central da Live com memória crescendo (~145 MB/min) e metade do tempo travada.** Recebe os mesmos cartões mais pedidos/tentativas/fixados ~45x/min (427 KB/min só de tentativas). Em uma hora o navegador passa de vários GB e fica muito lento. Correção mínima (exige publicar): mesma correção do item 1 + não repetir pedidos/fixados/tentativas a cada mensagem; até lá, **recarregar a aba (F5) a cada ~30 min** alivia.
3. **PDV WhatsApp baixando a lista inteira de conversas a cada ~5 s (27 MB/min).** Provável laço de "recarga completa" com nova tentativa a cada 5 s (erro ou troca de parâmetros), quando deveria ser só a cada 10 min. Pesa na internet da loja e no servidor de funções. Correção mínima (exige publicar): impedir recarga completa repetida e usar só a atualização incremental; confirmar antes se a chamada está falhando.

Nada pode ser corrigido no servidor sem publicar: os três problemas estão no navegador.

## Próximo passo (se aprovar)
- Fase 1 (pequena, testável): cartão sem remonte e sem buscas repetidas; medir de novo (meta: < 100 req/min e nenhuma travada > 200 ms no Kanban).
- Fase 2: busca em lote das informações dos cartões.
- Fase 3: PDV WhatsApp sem recarga completa em laço.
Cada fase é medida com o mesmo teste de 60 s antes de você publicar.
