import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import before from './fixtures/pdvLiveBefore.json';
const currentFile = readFileSync('src/components/pos/POSWhatsApp.tsx','utf8');
const start=currentFile.indexOf('        const map: Record<string,');
const projection=currentFile.slice(start,currentFile.indexOf('        if (!cancelled)',start));
function run(code: string, orders: unknown[]) {
  const js=ts.transpileModule(`${code}\nreturn {map,ghosts};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function('orders','stageMap','eventNameById','eventWnById',js)(orders,{pendente:'Aguardando',pago:'Pago'},{e:'Live'},{e:'instance'});
}
describe('Live POS projection before/after same inputs -> same cards',()=>{
 const newest={id:'new',event_id:'e',stage:'pago',is_paid:true,created_at:'2026-11-28',updated_at:'2026-11-28',customer:{whatsapp:'5533999999999',instagram_handle:'ana'}};
 const unpaid={...newest,id:'old',stage:'pendente',is_paid:false,created_at:'2026-11-27'};
 const scenarios=[[],[newest],[newest,unpaid],[{...newest,customer:{whatsapp:'',instagram_handle:'zero'}},unpaid],[{...newest,customer:{whatsapp:'33999999999',instagram_handle:'ana'}},unpaid]];
 scenarios.forEach((input,i)=>it(`case ${i}`,()=>expect(run(projection,input)).toEqual(run(before.projection,input))));
 it('newest unpaid wins over newer paid',()=>expect(run(projection,[newest,unpaid]).map['99999999'].orderId).toBe('old'));
});
