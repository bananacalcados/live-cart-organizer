CREATE OR REPLACE FUNCTION public.parse_live_comment_codes(p_text text)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $function$
declare t text; codes text[]; sizes text[]; last4 text; m text[]; letter_sizes text[]; pref boolean := false; halves text[];
begin
  t := upper(coalesce(p_text,''));
  -- meio número (36,5 / 36.5 / 36 e meio): vira o inteiro e fica registrado
  halves := array(select x[1] from regexp_matches(t, '(?<![0-9])(3[3-9]|4[0-4])(?:[,.]5|\s+E\s+MEIO)(?![0-9])', 'g') x);
  t := regexp_replace(t, '(?<![0-9])(3[3-9]|4[0-4])(?:[,.]5|\s+E\s+MEIO)(?![0-9])', ' \1 ', 'g');
  -- códigos primeiro (antes da pontuação, para "T226,39" não virar preço)
  codes := array(select distinct on (x[1]||x[2]) x[1]||x[2]
                 from regexp_matches(t, '(?<![A-Z0-9])([A-HJKMNP-Z])[ \-]?([0-9]{3})(?![0-9])', 'g') x);
  t := regexp_replace(t, '(?<![A-Z0-9])([A-HJKMNP-Z])[ \-]?([0-9]{3})(?![0-9])', ' ', 'g');
  -- preço tipo 400,00 / 1.200,00 é ignorado
  t := regexp_replace(t, '(?<![0-9])[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}(?![0-9])', ' ', 'g');
  -- pontuação vira espaço
  t := regexp_replace(t, '[,.:;/|–—]', ' ', 'g');
  m := regexp_match(t, '(FINAL|ZAP|WHATS\w*|WATTS|CELULAR|CEL|TEL\w*|FONE|NUMERO|NÚMERO)[^0-9]{0,12}([0-9]{4})(?![0-9])');
  if m is not null then last4 := m[2]; pref := true;
  else
    m := regexp_match(t, '(?<![0-9])([0-9]{4})(?![0-9])');
    if m is not null then last4 := m[1]; end if;
  end if;
  if last4 is not null then t := regexp_replace(t, '(?<![0-9])'||last4||'(?![0-9])', ' '); end if;
  sizes := array(select x[1] from regexp_matches(t, '(?<![0-9])([0-9]{2})(?![0-9])', 'g') x
                 where x[1]::int between 15 and 46);
  letter_sizes := array(select x[1] from regexp_matches(t, '(?<![A-Z])(PP|GG|XG|P|M|G)(?![A-Z])', 'g') x);
  if coalesce(array_length(sizes,1),0) = 0 and coalesce(array_length(letter_sizes,1),0) > 0 then sizes := letter_sizes; end if;
  return jsonb_build_object('codes', to_jsonb(coalesce(codes,'{}')), 'sizes', to_jsonb(coalesce(sizes,'{}')), 'last4', last4,
    'last4_prefixed', pref, 'half_sizes', to_jsonb(coalesce(halves,'{}')));
end $function$;