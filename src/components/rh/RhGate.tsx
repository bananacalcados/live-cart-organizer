import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LockKeyhole } from 'lucide-react';
import { changeAreaPassword, isAreaUnlocked, unlockArea } from '@/lib/areaPassword';
import { useAuthReady } from '@/hooks/useAuthReady';
// Session unlock is a screen gate, never an authorization source: every RH RPC checks admin.
const unlockedUsers=new Set<string>();
export function RhGate({passwordSet,children}:{passwordSet:boolean;children:React.ReactNode}) {
 const {user}=useAuthReady();const uid=user?.id||'';
 const [unlocked,setUnlocked]=useState(()=>isAreaUnlocked('rh'));
 const [configured,setConfigured]=useState(passwordSet);
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 if(configured&&(unlocked||unlockedUsers.has(uid)))return <>{children}</>;
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
 if(!configured){if(password.length<6||password!==confirm)throw new Error('Use pelo menos 6 caracteres e confirme a mesma senha.');await changeAreaPassword('rh','',password);setConfigured(true);setPassword('');setConfirm('');}
 else{const result=await unlockArea('rh',password);if(!result.ok)throw new Error(result.message);unlockedUsers.add(uid);setUnlocked(true);setPassword('');}
 }catch(e){setError(e instanceof Error?e.message:'Não foi possível conferir.');}finally{setBusy(false);}}
 return <div className="mx-auto max-w-sm py-12 px-4 text-foreground"><LockKeyhole className="h-8 w-8 mb-4 text-primary"/><h2 className="text-xl font-semibold mb-6">{configured?'Destravar área RH':'Defina a senha da área RH'}</h2><form onSubmit={submit} className="space-y-4"><div><Label htmlFor="rh-password">{configured?'Senha da área RH':'Nova senha'}</Label><Input id="rh-password" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={configured?undefined:6} required/></div>{!configured&&<div><Label htmlFor="rh-confirm">Confirmar senha</Label><Input id="rh-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={6} required/></div>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy} className="w-full">{busy?'Aguarde…':configured?'Destravar':'Definir senha'}</Button></form></div>;
}
