# Variável `{member_area_link}` — link autenticado da Área de Membros

Sim, é possível. A ideia é gerar um **link mágico por cliente** (token secreto e longo) que, ao ser clicado, já abre `/minha-area` com a sessão daquela cliente criada — sem digitar telefone nem código.

## Como vai funcionar

1. No mapeamento de variáveis do template Meta (e nos demais seletores de token) aparece uma nova opção: **`{member_area_link}` — Link da Área de Membros (já autenticado)**.
2. No momento do disparo, o sistema gera/reaproveita um token exclusivo do telefone daquela destinatária e monta a URL:
   `https://checkout.bananacalcados.com.br/minha-area?ml=TOKEN`
3. A cliente clica → a página detecta `?ml=`, troca o token por uma sessão válida, limpa o parâmetro da URL e cai direto na área dela.
4. Se o token estiver expirado/revogado, ela cai na tela normal de telefone (nada quebra).

## Regras de segurança

- Token aleatório de 32+ bytes, guardado **com hash** no banco (o valor puro só existe dentro do link).
- Validade padrão de 30 dias, renovável a cada novo disparo; revogável por telefone.
- Rate limit por IP e por token no resgate; tentativas inválidas registradas.
- O link mágico dá acesso à área e aos pedidos, **mas não desbloqueia dados sensíveis mascarados** (CPF/endereço completo continuam exigindo o código OTP), mantendo o padrão atual.
- Um telefone = um token ativo (rotaciona ao gerar novo).

## Detalhes técnicos

**Banco (migration)**
- Tabela `member_area_magic_links`: `id`, `phone`, `token_hash` (unique), `expires_at`, `last_used_at`, `revoked_at`, `created_at`. Sem acesso a `anon`/`authenticated` (só `service_role`); RLS ativa e GRANTs explícitos.
- Índices por `phone` e `token_hash`.

**Backend**
- `supabase/functions/_shared/member-magic-link.ts`: `issueMagicLink(phone)` (gera token, salva hash, devolve URL completa) e `redeemMagicLink(token)` (valida hash/validade e devolve o telefone).
- `live-member-area`: nova action `magic_enter` que resgata o token, reaproveita a lógica atual de `enter` (sem exigir OTP, já que o link é o fator de posse) e devolve o `state` + `token` de sessão.
- Resolução da variável nos disparos que já resolvem `{checkout_link}`:
  `event-order-template-send`, `event-followup-dispatcher`, `carousel-campaign-sender` (templates simples/carrossel) e o disparo em massa por template. Cada um chama `issueMagicLink(telefoneDoDestinatário)` só quando o template usa `{member_area_link}`.

**Frontend**
- `MetaTemplateConfigurator.tsx`: adicionar `{member_area_link}` em `AVAILABLE_TOKENS` (mesma lista usada no modal do print).
- Outros seletores que espelham a lista (`InitialMessageEditor`, `EventFollowupsManager`, painel de templates simples) recebem o mesmo token.
- `LiveMemberArea.tsx`: no boot, se houver `?ml=`, chamar `magic_enter`, salvar o token de sessão em `localStorage` como hoje, remover o parâmetro via `history.replaceState` e seguir direto para a etapa `area`. Fallback silencioso para o fluxo de telefone em caso de erro.

**Observação Meta**: o link entra no corpo do template como variável — ela não pode ficar no começo nem no fim do texto (regra já validada no editor).

## Fora do escopo
- Botão de URL dinâmica no template Meta (poderia ser feito depois; hoje o link vai no corpo).
- Login persistente por cookie entre dispositivos.
