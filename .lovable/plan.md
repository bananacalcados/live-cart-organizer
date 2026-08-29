# Performance + Independência: plano em 3 fases

## O diagnóstico honesto (dados de agora)

Olhei o estado real do banco antes de propor qualquer migração:

- Tamanho do banco: **5.186 MB**
- Linhas totais: **1.247.391**
- Tabelas: **408**

Isso é um banco **pequeno**. Um servidor com essa carga não deveria ficar lento — e não fica. A lentidão não vem de falta de CPU/RAM do servidor: vem de **como o app consulta os dados**. As três consultas que mais consomem tempo hoje provam isso:

| Consulta | Chamadas | Média | Tempo total |
|---|---|---|---|
| `pos_sales WHERE customer_phone ILIKE ...` | 3.543 | **416 ms** (pico 7 s) | 24,5 min |
| `SELECT * FROM chat_contacts` (sem filtro) | **67.135** | 15 ms | 16,9 min |
| `INSERT em whatsapp_messages` | 706 | **1.298 ms** (pico 7,7 s) | 15,3 min |

O que isso significa em português:

1. **Busca de venda por telefone usa `ILIKE`** — isso ignora qualquer índice e varre a tabela inteira toda vez. É o campeão de lentidão.
2. **A lista inteira de contatos do chat é baixada 67 mil vezes** — o app puxa a tabela toda em vez de buscar só o contato necessário.
3. **Gravar uma mensagem de WhatsApp leva 1,3 s** — sinal clássico de excesso de triggers/índices na tabela mais escrita do sistema.

Migrar isso para um servidor maior faria essas mesmas consultas rodarem talvez 30% mais rápido — e em dois meses estaríamos de novo no mesmo lugar, agora com você pagando servidor e administrando infra. É exatamente o padrão que você descreveu: "resolve momentaneamente e volta".

Por isso o plano abaixo ataca a causa primeiro, e trata independência como um objetivo separado (que é legítimo, mas não é o remédio da lentidão).

---

## Fase 1 — Matar as causas da lentidão (impacto imediato)

1. **Índices e busca por telefone**
   - Trocar toda busca `ILIKE` em `pos_sales.customer_phone` por comparação por sufixo normalizado (DDD + 8 dígitos), com coluna indexada.
   - Índices `pg_trgm` onde busca textual livre for mesmo necessária.
2. **Parar de baixar tabelas inteiras**
   - `chat_contacts`: consulta por telefone/instância em vez de `select *`; cache compartilhado com TTL no lugar das 67 mil chamadas.
   - Auditar os demais `select('*')` sem filtro no PDV e no Chat.
3. **Desafogar `whatsapp_messages`**
   - Revisar triggers disparados em cada insert e mover o que não é crítico para processamento assíncrono.
   - Revisar índices redundantes (cada índice extra custa em toda gravação).

Resultado esperado: o uso diário (PDV, Chat, cards de pedido) volta a responder rápido — sem trocar de servidor.

## Fase 2 — Impedir que a lentidão volte (é aqui que o padrão se quebra)

O que faltou nas vezes anteriores foi vigilância contínua. Sem isso, cada funcionalidade nova reintroduz consultas pesadas.

1. **Painel interno de saúde do banco** — página admin listando as consultas mais lentas da semana, para você ver a degradação chegando antes dos clientes sentirem.
2. **Política de retenção** — arquivar mensagens de WhatsApp e logs antigos para tabelas históricas. Hoje as tabelas de maior escrita crescem para sempre.
3. **Regra de projeto** — toda nova tela passa a nascer com filtro e paginação obrigatórios; nada de `select *` aberto.

## Fase 3 — Independência e controle (quando você quiser, sem pressa)

Independente da performance, você tem direito a controlar sua infra. Caminhos reais:

- **Código (frontend + edge functions):** já sai daqui via GitHub. Você pode hospedar em VPS/Vercel/Cloudflare seu e continuar editando por aqui — cada alteração vira commit e o deploy é automático. Isso é reversível e de baixo risco. **Recomendo fazer isso já**, na Fase 1 ou 2.
- **Banco de dados:** o Postgres pode ir para uma instância Supabase própria (self-hosted ou conta Supabase sua) ou um Postgres gerenciado. Aí você é dono do backup, do tamanho da máquina e das extensões.
  - Custo real: cutover com janela de indisponibilidade, reconfiguração de todos os webhooks (Mercado Pago, Shopify, Meta, uazapi, WaSender), migração de secrets e dos crons.
  - Trade-off: mais controle, mais responsabilidade operacional (backup, atualização, monitoramento são seus).
- **Continuar editando aqui após migrar:** sim, funciona — o código continua sincronizado por Git; o que muda é para onde apontam as variáveis de banco.

---

## Recomendação

Começar pela **Fase 1**. Ela é rápida, não tem risco de cutover e resolve o sintoma que está te incomodando hoje. A Fase 3 (independência) é uma decisão estratégica sua, não uma emergência técnica — e fica muito mais segura de executar depois que as consultas estiverem saudáveis, porque aí você migra um sistema eficiente em vez de levar o problema junto.

Se aprovar, começo pela Fase 1, item 1 (busca por telefone em `pos_sales`), que sozinha é o maior ganho isolado.
