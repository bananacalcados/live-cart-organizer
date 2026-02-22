

# Plano de Otimizacao de Performance

## Problema identificado

O sistema esta lento porque algumas telas carregam volumes enormes de dados de uma so vez:

- **Chat**: Carrega TODAS as 76.000+ mensagens do WhatsApp para montar a lista de conversas. Isso e feito a cada INSERT via Realtime, ou seja, cada nova mensagem recarrega 76k registros.
- **Home**: Faz uma chamada RPC por modulo (ate 9 chamadas) para verificar permissoes.
- **ProtectedRoute**: Faz outra chamada RPC a cada navegacao.
- **TeamChat**: Roda em TODAS as paginas, fazendo queries adicionais em cada tela.

## Sobre separar modulos em projetos

**Nao recomendo.** Os motivos:

- A lentidao nao e causada pelo tamanho do codigo, mas sim por queries ineficientes no banco de dados
- Separar em projetos criaria complexidade enorme: autenticacao compartilhada, comunicacao entre APIs, duplicacao de configuracoes
- O banco de dados continuaria o mesmo, entao os mesmos problemas de performance persistiriam
- A solucao correta e otimizar as queries, nao dividir o sistema

## Solucao proposta

### 1. Criar RPC para lista de conversas (maior impacto)

Em vez de carregar 76k mensagens no frontend, criar uma funcao no banco que retorna apenas a ultima mensagem de cada telefone, com contagem de nao-lidas. Isso reduz de 76k registros para ~3.600 registros (um por conversa).

```sql
CREATE FUNCTION get_conversations(p_number_id UUID DEFAULT NULL)
RETURNS TABLE (
  phone TEXT,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count BIGINT,
  direction TEXT,
  is_group BOOLEAN
)
```

### 2. Unificar verificacao de permissoes em uma unica RPC

Em vez de 9 chamadas separadas na Home, criar uma funcao que retorna todos os modulos permitidos de uma vez:

```sql
CREATE FUNCTION get_user_allowed_modules(p_user_id UUID)
RETURNS TEXT[]
```

### 3. Implementar lazy loading no App.tsx

Usar `React.lazy()` para que cada modulo so carregue seu JavaScript quando o usuario navegar ate ele. Hoje todos os 15+ modulos sao importados no carregamento inicial.

### 4. Paginar mensagens do chat

Ao abrir uma conversa, carregar apenas as ultimas 50 mensagens e implementar "carregar mais" ao rolar para cima.

### 5. Otimizar TeamChat

Adicionar um debounce e evitar recarregar mensagens a cada mudanca de rota.

---

## Detalhes tecnicos

### Arquivos que serao modificados:

| Arquivo | Mudanca |
|---|---|
| **Nova migration SQL** | Criar RPCs `get_conversations` e `get_user_allowed_modules` |
| **src/pages/Chat.tsx** | Usar a nova RPC em vez de carregar todas as mensagens; paginar mensagens individuais |
| **src/pages/Home.tsx** | Usar `get_user_allowed_modules` em uma unica chamada |
| **src/components/ProtectedRoute.tsx** | Cachear resultado de permissoes para evitar re-chamadas |
| **src/App.tsx** | Adicionar `React.lazy()` nos imports dos modulos |

### Resultado esperado:

- Chat: de ~76k registros para ~3.6k (reducao de 95%)
- Home: de 9 chamadas RPC para 1
- Carregamento inicial: apenas o codigo do modulo atual e baixado
- Nenhuma configuracao existente sera perdida

