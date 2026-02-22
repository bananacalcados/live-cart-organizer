

# Correcao das Fotos de Perfil no WhatsApp POS

## Problema Encontrado

As fotos nao aparecem porque a Edge Function `zapi-profile-picture` esta chamando a API do Z-API com o formato de URL **errado**.

**URL atual (incorreta):**
```
GET /profile-picture/5533987267222
```

**URL correta (conforme documentacao Z-API):**
```
GET /profile-picture?phone=5533987267222
```

Alem disso, a resposta da API e um **array** `[{"link": "url"}]`, mas o codigo trata como objeto simples. Como a URL esta errada, a API retorna 200 mas sem dados, resultando em `photos: {}` em todas as chamadas.

## Solucao

Alterar **apenas** a Edge Function `supabase/functions/zapi-profile-picture/index.ts`:

1. Mudar a URL de `profile-picture/${cleanPhone}` para `profile-picture?phone=${cleanPhone}`
2. Tratar a resposta como array: pegar `data[0]?.link` em vez de `data?.link`
3. Adicionar log para debug caso a resposta nao tenha link

O restante do sistema ja esta preparado: o componente `POSWhatsApp.tsx` ja busca fotos para phones sem foto, e o `ConversationList.tsx` ja renderiza o `AvatarImage` quando `contactPhotos[phone]` existe. O problema e exclusivamente na chamada da API.

## Detalhes Tecnicos

**Arquivo:** `supabase/functions/zapi-profile-picture/index.ts`

Alteracoes na linha 45:
- De: ``const url = `...profile-picture/${cleanPhone}`;``
- Para: ``const url = `...profile-picture?phone=${cleanPhone}`;``

Alteracoes na linha 53-54:
- Tratar resposta como array
- `const picUrl = Array.isArray(data) ? data[0]?.link : (data?.link || data?.profilePictureUrl || data?.url || null);`

