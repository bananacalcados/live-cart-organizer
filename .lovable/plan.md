## Objetivo

Adicionar correção ortográfica nos inputs de mensagem dos chats de WhatsApp (POS e Chat geral), de forma 100% isolada na camada de UI, sem alterar `handleSend`, `useChatSender` nem o roteamento de instâncias.

Duas correções, com comportamentos diferentes:
1. **Maiúscula no início de frase → automática** (aplicada enquanto digita, transparente).
2. **Palavras escritas erradas → apenas sugestão** (nunca troca sozinha; vendedora aceita com 1 clique).

Dicionário **offline pt-BR** (sem IA, sem custo, sem latência de rede).

## Onde encaixa (2 pontos de entrada)

- `src/components/chat/ChatView.tsx` (usado pelo POS via `POSWhatsApp.tsx`) — textarea em ~linha 1064, callback `onNewMessageChange`.
- `src/pages/Chat.tsx` — textarea inline em ~linha 1503, `setNewMessage`.

Nada além do `onChange`/exibição é tocado. O texto final continua saindo por `handleSend` exatamente como hoje.

## Arquitetura

### 1. Engine de ortografia (sem IA)
- Lib `nspell` + dicionário Hunspell pt-BR (`dictionary-pt`), carregado **lazy** só quando um chat abre (≈1 MB, fica em cache no módulo, carrega 1x por sessão).
- Função `capitalizeSentences(text)`: capitaliza a 1ª letra do texto e após `.`, `!`, `?`, quebra de linha. Pura, sem dependência.
- Função `findMisspellings(text)`: tokeniza, ignora (a) palavras numéricas/URLs/emojis, (b) tudo que já está em UPPERCASE (siglas), (c) uma **allowlist de exceções** (gírias e marcas: "vc", "blz", "pra", "Modare", "Usaflex", "Beira Rio", etc.) — para reduzir falsos positivos do dicionário offline. Retorna lista `{ word, start, end, suggestions[] }`.

### 2. Hook `useSpellAssist`
- Recebe o texto atual; com debounce (~400 ms) roda `findMisspellings`.
- Expõe: `suggestions[]`, `applySuggestion(word, replacement)` (devolve novo texto), `dismiss(word)` (ignora na sessão), `addToDictionary(word)` (persiste exceção pessoal em `localStorage`).
- A maiúscula automática é aplicada no `onChange` antes de setar o estado (só capitaliza, nunca apaga o que a pessoa digitou).

### 3. UI: barra de sugestões discreta
- Componente `SpellSuggestionBar` renderizado **acima do input** (não sobre ele — evita o complexo overlay de "sublinhado ondulado" no textarea, que é frágil).
- Mostra chips: `palavra → sugestão` com ✓ (aplica) e ✕ (ignora). Some sozinha quando não há erros.
- Estilo discreto com tokens do design system, não bloqueia digitação nem envio.
- Botão pequeno "Aa" opcional para ligar/desligar o assistente por conversa (preferência em `localStorage`).

## Por que assim (não-breaking)

- Maiúscula é transformação idempotente e conservadora (só primeira letra de frase) — não altera conteúdo digitado.
- Ortografia é **sugestão**: o estado `newMessage` só muda se a vendedora clicar em aplicar. Sem clique, nada muda → impossível enviar algo "auto-corrigido" errado.
- Dicionário offline + allowlist evita marcar gírias/marcas. Lazy-load evita peso no bundle inicial.
- Zero mudança em edge functions, banco ou fluxo de envio.

## Passos de implementação

1. `bun add nspell dictionary-pt` (e tipos se necessário).
2. `src/lib/spellAssist/capitalize.ts` — `capitalizeSentences`.
3. `src/lib/spellAssist/dictionary.ts` — loader lazy do nspell + allowlist + `findMisspellings`.
4. `src/hooks/useSpellAssist.ts` — debounce, sugestões, apply/dismiss/addToDictionary.
5. `src/components/chat/SpellSuggestionBar.tsx` — UI dos chips.
6. Integrar em `ChatView.tsx`: aplicar `capitalizeSentences` no `onNewMessageChange` e renderizar a barra acima do input.
7. Integrar em `Chat.tsx`: mesmo padrão no textarea inline.
8. Testes unitários de `capitalizeSentences` e `findMisspellings` (incluindo allowlist).

## Detalhes técnicos

- Debounce de 400 ms para não rodar o dicionário a cada tecla.
- Tokenização preservando offsets (start/end) para aplicar a troca sem perder pontuação.
- `nspell.suggest()` limitado a 3 sugestões por palavra (perf + UI enxuta).
- Allowlist em arquivo versionado + exceções pessoais em `localStorage` (`spellassist:ignored`).
- Toggle de ligar/desligar por conversa em `localStorage` (`spellassist:enabled`).

## Fora de escopo (fases seguintes, já combinadas)

- Lembretes de regra de atendimento + contadores de follow-up.
- Score de qualidade do atendimento.
- Correção via IA (botão "Revisar com IA").