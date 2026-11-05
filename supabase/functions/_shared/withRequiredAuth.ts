import { requireAuth } from './requireAuth.ts';
export function withRequiredAuth(modules: string[],adminOnly: boolean,handler: (req: Request, info?: any)=>Response|Promise<Response>) {
  return async (req: Request,info?: any) => {
    if (req.method === 'OPTIONS') return handler(req,info);
    const denied=await requireAuth(req,modules,adminOnly);
    return denied ?? handler(req,info);
  };
}