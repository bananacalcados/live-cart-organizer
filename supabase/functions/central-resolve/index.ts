import { logClient, withAccessLog } from '../_shared/withAccessLog.ts';
import { centralHandler, settingsFlag } from '../_shared/central-handler.ts';
const db=logClient();
if (!db) throw new Error('Central indisponível');
// Opens only when support_settings.central_public_enabled is turned on by an admin (currently off).
Deno.serve(withAccessLog('central-resolve',centralHandler('resolve',db as any,settingsFlag(db as any))));
