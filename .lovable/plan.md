# Performance, Independência e Venda do Sistema (SaaS)

## Parte A — O diagnóstico da lentidão (dados de agora)

Antes de propor migração, olhei o estado real do banco:

- Tamanho do banco: **5.186 MB**
- Linhas totais: **~1,25 milhão**
- Tabelas: **408**

Isso é um banco **pequeno**. A lentidão não vem de falta de CPU/RAM: vem de **como o app consulta os dados**. As consultas mais caras hoje:

| Consulta | Chamadas | Média | Tempo total |
|---|---|---|---|
| `pos_sales WHERE customer_phone ILIKE ...` | 3.543 | **416 ms** (pico 7 s) | 24,5 min |
| `SELECT * FROM chat_contacts` (sem filtro) | **67.135** | 15 ms | 16,9 min |
| `INSERT em whatsapp_messages` | 706 | **1.298 ms** (pico 7,7 s) | 15,3 min |

Em português:

1. **Busca de venda por telefone usa `ILIKE`** — ignora índice e varre a tabela inteira toda vez.
2. **A lista inteira de contatos do chat é baixada 67 mil vezes** — o app puxa a tabela toda em vez de buscar só o contato.
3. **Gravar uma mensagem de WhatsApp leva 1,3 s** — excesso de triggers/índices na tabela mais escrita do sistema.

Trocar de servidor deixaria essas mesmas consultas talvez 30% mais rápidas — e em dois meses voltaríamos ao mesmo lugar, agora com você pagando e administrando infra. É exatamente o padrão que você descreveu.

---

## Parte B — Vender o sistema para outras empresas: é possível?

Sim, é possível. Mas preciso ser direto sobre o tamanho da coisa, porque a decisão certa aqui depende disso.

Hoje o banco tem **374 tabelas e praticamente nenhuma coluna `tenant_id`** (encontrei apenas 1). Existem ~300 funções de banco e ~200 edge functions escritas assumindo que **existe uma única empresa**: a Banana Calçados.

Isso abre dois caminhos, e eles são muito diferentes em custo e risco.

### Caminho 1 — Banco compartilhado com `tenant_id` (o modelo "Bling/Tiny")

Todas as empresas dividem o mesmo banco; cada linha carrega o `tenant_id` do dono; RLS filtra por empresa.

- Exige adicionar `tenant_id` em ~374 tabelas, reescrever ~374 conjuntos de políticas RLS, revisar ~300 funções de banco e ~200 edge functions uma a uma.
- **Todo lugar esquecido é um vazamento de dados entre clientes.** Uma função `SECURITY DEFINER` sem filtro de tenant entrega a base de clientes de uma empresa para outra. E o projeto usa muitas.
- Vantagem: custo de infra baixíssimo por cliente, atualização instantânea para todos.
- Realidade: é um projeto de meses, e o risco de vazamento durante a transição é alto.

### Caminho 2 — Um banco por cliente, mesmo código (modelo "silo") — **recomendado**

Cada empresa cliente ganha a própria instância de banco. O **código é um só**, versionado no Git; ao atualizar, o deploy vai para todas as instâncias.

- **Isolamento por construção**: é fisicamente impossível o cliente A ver dados do cliente B, porque não existe conexão entre os bancos. Nada de esquecer um filtro.
- **Performance não se mistura**: uma live pesada de um cliente não derruba o PDV de outro. Isso resolve, de graça, a preocupação de "pesar os dados".
- **Atualização única**: exatamente como você descreveu — melhora feita aqui vai para todos, porque todos rodam o mesmo código. O que precisa de disciplina é o versionamento das **migrações de banco**, que passam a rodar em sequência em cada instância.
- Custo: cada cliente tem sua própria infra (mais caro por cliente que o compartilhado, mas repassável na mensalidade), e você precisa de um processo automatizado de provisionamento.
- Trabalho no código: **muito menor** — não é preciso mexer em 374 tabelas. O código já funciona; só passa a apontar para bancos diferentes.

Minha recomendação é o Caminho 2. Ele entrega o mesmo resultado comercial com uma fração do risco de vazamento, e é o único que dá para executar sem parar a operação da Banana.

### Módulos por cliente

Independente do caminho, o controle de módulos é a parte fácil — o projeto **já tem a base**: `ProtectedRoute` com `requiredModule` e a função `get_user_allowed_modules`. O que falta:

- Tabela de **licença** por instância: quais módulos estão contratados (PDV, Eventos/Live, Marketing, Fiscal, Expedição, Financeiro...).
- O gate de módulo passa a checar **licença E permissão do usuário** — hoje só checa permissão.
- Menu e rotas escondem o que não está contratado.
- Um painel só seu (fora do sistema do cliente) para ligar/desligar módulo por cliente.

### O que cada cliente configura sozinho

Já existe estrutura para quase tudo — o que precisa é tirar o que hoje está fixo no código e mover para configuração:

- **Lojas e estoque**: já é multi-loja (`pos_stores`), funciona.
- **Conexões de WhatsApp**: já é multi-instância (`whatsapp_numbers`), funciona.
- **Base de clientes, vendedoras, metas, comissões**: já são dados de banco.
- **Precisa ser destravado**: gateways de pagamento, credenciais fiscais/certificado digital, integração Shopify, domínio de checkout, textos e regras hoje escritos com o nome/regras da Banana (frete de GV, retirada só em GV, e-mail `@cliente.bananacalcados.com.br`, identidade visual).

---

## Parte C — Ordem de execução recomendada

**Fase 1 — Performance (fazer já, sem depender de nada)**
1. Substituir a busca `ILIKE` por telefone em `pos_sales` por busca indexada por sufixo (DDD + 8 dígitos).
2. Parar de baixar `chat_contacts` inteira: consulta filtrada + cache com TTL.
3. Desafogar `whatsapp_messages`: revisar triggers do insert e índices redundantes.
4. Retenção: arquivar `dispatch_recipients` (636 mil linhas), `webhook_events_raw` (155 mil) e mensagens antigas.

Isso vale por si só — e vale ainda mais depois, porque você não quer vender para 10 clientes um sistema com esses gargalos replicados 10 vezes.

**Fase 2 — Não deixar a lentidão voltar**
5. Painel interno de saúde do banco (consultas mais lentas da semana), para ver a degradação chegando.
6. Regra de projeto: toda tela nova nasce com filtro e paginação; nada de `select *` aberto.

**Fase 3 — Preparar para SaaS (sem ainda ter cliente)**
7. Tabela de licença + gate de módulos ligado à licença.
8. Extrair para configuração tudo que hoje está fixo com a marca e as regras da Banana.
9. Definir e testar o processo de migração versionada de banco (a peça crítica do modelo silo).

**Fase 4 — Independência de infra**
10. Frontend e edge functions hospedados em infra sua via GitHub — continua editável aqui, cada alteração vira commit com deploy automático.
11. Banco em instância própria, com cutover planejado (reconfigurar webhooks de Mercado Pago, Shopify, Meta, uazapi, WaSender; migrar secrets e crons).

**Fase 5 — Primeiro cliente**
12. Provisionamento automatizado: criar instância, rodar migrações, semear dados iniciais, ativar módulos contratados.
13. Onboarding: o cliente cadastra lojas, estoque, WhatsApp, gateways e dados fiscais dele.

---

## Recomendação final

Não misturar as duas coisas. A Fase 1 é rápida, sem risco, e resolve a dor de hoje. A virada para SaaS é uma decisão de negócio que fica muito mais barata e segura depois que o sistema estiver eficiente — senão você replica os gargalos atuais em cada cliente novo.

Se aprovar, começo pela Fase 1, item 1 (busca por telefone em `pos_sales`), que é o maior ganho isolado.
