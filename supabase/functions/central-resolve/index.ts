import { logClient, withAccessLog } from '../_shared/withAccessLog.ts';
import { centralHandler } from '../_shared/central-handler.ts';
const db=logClient();
if (!db) throw new Error('Central indisponível');
Deno.serve(withAccessLog('central-resolve',centralHandler('resolve',db,async()=>false)));