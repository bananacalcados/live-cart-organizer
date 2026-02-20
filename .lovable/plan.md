

# Sistema de Campanhas com IAs Especializadas por Canal

## Visao Geral

Transformar o sistema atual de campanha 360 (que gera tudo de uma vez com um prompt livre) em uma arquitetura de **IA Matriz + IAs Especialistas por canal**, onde:

1. A **IA Matriz** cria a diretriz geral da campanha (conceito, tom, mensagem-chave)
2. **IAs Especialistas** por canal recebem essa diretriz + parametros estruturados (selecionados via caixas/formularios) e geram planos detalhados e acionaveis para cada canal
3. O usuario pode criar campanhas **multi-canal** (todos) ou **canal unico**

## Canais Especialistas

| Canal | Parametros configuráveis (caixas de selecao) |
|-------|----------------------------------------------|
| **Grupo VIP** | Data execucao, Qtd etapas, Explicacao etapas, Qtd mensagens/etapa, Data de cada etapa, Tipo de conteudo (texto/imagem/enquete) |
| **WhatsApp Marketing** | Publico-alvo (segmentos RFM), Qtd mensagens, Qtd etapas, Template Meta a usar, Delay entre etapas, Horario de envio |
| **Instagram** | Tipos de conteudo (Reels/Feed/Stories), Qtd posts por tipo, Frequencia semanal, Usar influenciador?, Investir em Ads? |
| **Loja Fisica** | Publico, Canal divulgacao (carro de som/panfleto/vitrine), Qtd mensagens, Organizacao da loja, Metas vendedoras, Gamificacao |
| **Email Marketing** | Qtd emails, Frequencia, Segmentacao de lista, Automacoes (welcome/abandoned), Layout |
| **Site** | Banners, Pop-ups, Landing page, Cupom exclusivo |

## Fluxo do Usuario

```text
+------------------+     +-------------------+     +---------------------+
| 1. Escolher modo |---->| 2. IA Matriz gera |---->| 3. Configurar cada  |
| (360 ou canal    |     |    diretriz geral  |     |    canal com caixas |
|  unico)          |     |    (conceito, tom) |     |    de parametros    |
+------------------+     +-------------------+     +---------------------+
                                                            |
                                                            v
                                                    +---------------------+
                                                    | 4. IA Especialista  |
                                                    |    gera plano       |
                                                    |    detalhado +      |
                                                    |    acoes prontas    |
                                                    +---------------------+
                                                            |
                                                            v
                                                    +---------------------+
                                                    | 5. Revisar, editar  |
                                                    |    e salvar campanha|
                                                    +---------------------+
```

## Detalhes Tecnicos

### 1. Nova pagina `/marketing/new` (refatorar a existente)

**Etapa 1 - Modo de criacao:**
- Botao "Campanha 360 (todos os canais)" ou selecionar canais especificos
- Campo de objetivo geral (obrigatorio)
- Botao "Gerar Diretriz" chama a IA Matriz

**Etapa 2 - Diretriz Matriz (resultado da IA geral):**
- Exibe: nome da campanha, conceito central, tom de voz, mensagem-chave, publico
- Editavel pelo usuario antes de prosseguir

**Etapa 3 - Configuracao por canal (formularios estruturados):**
- Para cada canal selecionado, exibe um card/tab com caixas de selecao e inputs especificos
- Nenhum prompt livre: tudo via selecao de opcoes
- Botao "Gerar Plano" por canal (chama IA especialista)

**Etapa 4 - Revisao e salvamento:**
- Visualiza todos os planos gerados por canal
- Edita mensagens/copies individuais
- Salva como campanha

### 2. Edge Functions (backend)

**`ai-marketing-master`** (nova) - IA Matriz:
- Recebe: objetivo, publico, instrucoes gerais
- Retorna: conceito central, tom de voz, mensagens-chave, metas gerais
- Prompt mais enxuto focado em diretriz estrategica

**`ai-channel-specialist`** (nova) - IA Especialista:
- Recebe: diretriz da matriz + parametros estruturados do canal
- Parametro `channel_type` determina o prompt especializado
- Cada canal tem seu prompt otimizado com regras especificas
- Retorna: plano detalhado com copies prontas, cronograma, acoes

### 3. Banco de dados

Nenhuma mudanca de schema necessaria. As tabelas `marketing_campaigns`, `campaign_channels` e `campaign_tasks` ja suportam o modelo. Os parametros estruturados serao salvos no campo `content_plan` (jsonb) de `campaign_channels`.

### 4. Componentes React

- **`ChannelConfigurator.tsx`** (novo): componente com formularios dinamicos por canal (caixas de selecao, inputs numericos, datas)
- **`MasterDirectiveCard.tsx`** (novo): exibe/edita a diretriz da IA Matriz
- **`ChannelPlanResult.tsx`** (novo): exibe o plano gerado pela IA especialista com copies editaveis
- Refatorar `NewCampaign.tsx` para orquestrar o novo fluxo de 4 etapas

### 5. Exemplo de parametros estruturados (Grupo VIP)

O usuario nao digita prompt. Ele seleciona:

- Data de execucao: [date picker]
- Quantidade de etapas: [select: 1, 2, 3, 4, 5]
- Para cada etapa:
  - Nome da etapa: [input]
  - Data: [date picker]
  - Qtd mensagens: [select: 1-10]
  - Tipo conteudo: [multi-select: texto, imagem, video, enquete]
  - Descricao: [textarea curta]

Esses parametros sao enviados junto com a diretriz matriz para a IA especialista, que gera as mensagens prontas.

## Ordem de Implementacao

1. Criar edge function `ai-marketing-master` (IA Matriz)
2. Criar edge function `ai-channel-specialist` (IA Especialista com prompts por canal)
3. Criar componentes `ChannelConfigurator`, `MasterDirectiveCard`, `ChannelPlanResult`
4. Refatorar `NewCampaign.tsx` com o novo fluxo de 4 etapas
5. Manter compatibilidade com campanhas existentes (a edge function antiga continua funcionando)

