import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const { type, groupName, brandContext } = await req.json();

    let prompt = '';

    if (type === 'description') {
      prompt = `Crie uma descrição curta e atrativa para um grupo VIP de WhatsApp chamado "${groupName}".
${brandContext ? `Contexto da marca: ${brandContext}` : 'A marca é de moda feminina chamada Banana Store.'}

A descrição deve:
- Ter no máximo 512 caracteres (limite do WhatsApp)
- Usar emojis relevantes
- Transmitir exclusividade e benefícios de ser VIP
- Ser convidativa e criar senso de pertencimento

Retorne APENAS a descrição, sem aspas nem explicações.`;
    } else if (type === 'pinned_message') {
      prompt = `Crie uma mensagem fixada (pinned message) para um grupo VIP de WhatsApp chamado "${groupName}".
${brandContext ? `Contexto da marca: ${brandContext}` : 'A marca é de moda feminina chamada Banana Store.'}

A mensagem deve:
- Dar as boas-vindas ao grupo VIP
- Explicar as regras básicas (respeito, sem spam)
- Listar os benefícios exclusivos (acesso antecipado, promoções, cupons)
- Usar emojis de forma elegante
- Ter um tom acolhedor e premium
- Ter no máximo 1000 caracteres

Retorne APENAS a mensagem, sem aspas nem explicações.`;
    } else if (type === 'photo_prompt') {
      prompt = `Crie um prompt em inglês para gerar uma imagem de capa para um grupo VIP de WhatsApp chamado "${groupName}".
${brandContext ? `Contexto da marca: ${brandContext}` : 'A marca é de moda feminina chamada Banana Store.'}

O prompt deve descrever uma imagem quadrada elegante e premium que funcione como foto de perfil de grupo.
Deve incluir o conceito visual, cores, estilo e elementos.

Retorne APENAS o prompt em inglês, sem aspas nem explicações.`;
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid type. Use: description, pinned_message, photo_prompt' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'Você é um especialista em marketing digital e comunidades VIP de WhatsApp para marcas de moda.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI gateway error:', response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded, tente novamente.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error('AI gateway error');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return new Response(
      JSON.stringify({ success: true, content: content.trim() }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ai-group-content:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
