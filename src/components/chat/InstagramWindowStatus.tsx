import {useEffect,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {instagramWindowLabel,type InstagramWindow} from '../../../supabase/functions/_shared/instagram-window';
export function InstagramWindowStatus({phone,numberId,messageId}:{phone:string;numberId:string|null;messageId?:string}){
 const [context,setContext]=useState<InstagramWindow|null>(null);
 useEffect(()=>{let alive=true;setContext(null);(async()=>{
  const {data:link}=await supabase.from('instagram_user_links').select('username').eq('ig_user_id',phone).limit(1).maybeSingle();
  if(!link?.username)return;
  const {data,error}=await supabase.rpc('instagram_reply_context',{p_username:link.username,p_number_id:numberId || undefined});
  if(alive&&!error)setContext(data as unknown as InstagramWindow);
 })();return()=>{alive=false;};},[phone,numberId,messageId]);
 return <div role="status" className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{context?instagramWindowLabel(context):'Conferindo janela do Instagram…'}</div>;
}