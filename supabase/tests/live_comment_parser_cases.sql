-- Teste do leitor de comentários da live (rodar no banco do projeto). Esperado x obtido; todas as linhas devem dar OK.
with cases(txt, codes, sizes, last4, halves) as (values
 ('T178 n.36','{T178}','{36}',null,'{}'),
 ('T176 TAM 37, 1151','{T176}','{37}','1151','{}'),
 ('T178,tamanho 35,7430','{T178}','{35}','7430','{}'),
 ('QUERO T226, Numero 36,1818','{T226}','{36}','1818','{}'),
 ('Quero NB 530 T224, Numero 36. 1818','{T224}','{36}','1818','{}'),
 ('t226,39','{T226}','{39}',null,'{}'),
 ('Tenho interesse tb no T222 tamanho 38, NB dourado','{T222}','{38}',null,'{}'),
 ('Quero t 222 tenis 35.  5224','{T222}','{35}','5224','{}'),
 ('T 251. N36.  7330. Eliane de Cássia Cotta','{T251}','{36}','7330','{}'),
 ('Eu T129 39.','{T129}','{39}',null,'{}'),
 ('T204 nr 39.  400,00?','{T204}','{39}',null,'{}'),
 ('Eu quero t204 nr  39.  9353','{T204}','{39}','9353','{}'),
 ('Eu qro T224.Numero 40. Fone 8636','{T224}','{40}','8636','{}'),
 ('T200.  37.  2161','{T200}','{37}','2161','{}'),
 ('Eliane N36. T195 7330','{T195}','{36}','7330','{}'),
 ('T234  e.  T236.  número 35.  7200','{T234,T236}','{35}','7200','{}'),
 ('T224:35.  0439','{T224}','{35}','0439','{}'),
 ('T124 38. Qual o valor?','{T124}','{38}',null,'{}'),
 ('T233 - 37 - 1206','{T233}','{37}','1206','{}'),
 ('T220 - N40 0988','{T220}','{40}','0988','{}'),
 ('T 200 39 - 1790','{T200}','{39}','1790','{}'),
 ('T227 n 37 WhatsApp 1001','{T227}','{37}','1001','{}'),
 ('T206 36 3243','{T206}','{36}','3243','{}'),
 ('Eu quero T 176 4191 37','{T176}','{37}','4191','{}'),
 ('Quero B061  B062  B060 - 5000','{B060,B061,B062}','{}','5000','{}'),
 ('P360 tem no 35?','{P360}','{35}',null,'{}'),
 ('T196 dourado número 36 / telefone 3840','{T196}','{36}','3840','{}'),
 ('UNB marrom  T224 - numero 36 - 6195','{T224}','{36}','6195','{}'),
 ('T224 36,5 1818','{T224}','{36}','1818','{36}'),
 ('T224 tam 37.5','{T224}','{37}',null,'{37}'),
 ('T224 38 e meio','{T224}','{38}',null,'{38}')
), r as (
 select txt, codes, sizes, last4, halves, parse_live_comment_codes(txt) p from cases)
select case when (select array_agg(x order by x) from jsonb_array_elements_text(p->'codes') x) is not distinct from (select array_agg(x order by x) from unnest(codes::text[]) x)
        and array(select jsonb_array_elements_text(p->'sizes')) = sizes::text[]
        and (p->>'last4') is not distinct from last4
        and array(select jsonb_array_elements_text(p->'half_sizes')) = halves::text[]
       then 'OK  ' else 'FALHOU' end as res, txt,
       'esperado '||codes||' '||sizes||' '||coalesce(last4,'-')||' | obtido '||(p->'codes')::text||' '||(p->'sizes')::text||' '||coalesce(p->>'last4','-')||' meio='||(p->'half_sizes')::text as det
from r;
