import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({handlers:{} as Record<string,()=>void>,subscribe:undefined as undefined|((s:string)=>void), remove:vi.fn(),channel:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{channel:mock.channel,removeChannel:mock.remove}}));
import { usePdvStoreEvents } from '@/hooks/usePdvStoreEvents';
beforeEach(()=>{
 vi.useFakeTimers();mock.handlers={};mock.remove.mockClear();mock.channel.mockClear();
 const channel={on:vi.fn((_:string,filter:{event:string},fn:()=>void)=>{mock.handlers[filter.event]=fn;return channel;}),subscribe:vi.fn((fn:(s:string)=>void)=>{mock.subscribe=fn;return channel;})};
 mock.channel.mockReturnValue(channel);Object.defineProperty(document,'hidden',{configurable:true,value:false});
});
afterEach(()=>vi.useRealTimers());
describe('PDV per-store events replace timers',()=>{
 it('idle minute sends zero fetches; burst sends one',()=>{
  const fn=vi.fn();const h=renderHook(()=>usePdvStoreEvents('s','sales_changed',fn));
  act(()=>vi.advanceTimersByTime(60000));expect(fn).not.toHaveBeenCalled();
  act(()=>{for(let i=0;i<20;i++)mock.handlers.sales_changed();vi.advanceTimersByTime(1000);});expect(fn).toHaveBeenCalledTimes(1);h.unmount();
 });
 it('hidden tab pauses and visibility returns reload once',()=>{
  const fn=vi.fn();const h=renderHook(()=>usePdvStoreEvents('s','sales_changed',fn));
  Object.defineProperty(document,'hidden',{configurable:true,value:true});act(()=>{mock.handlers.sales_changed();vi.advanceTimersByTime(60000);});expect(fn).not.toHaveBeenCalled();
  Object.defineProperty(document,'hidden',{configurable:true,value:false});act(()=>{document.dispatchEvent(new Event('visibilitychange'));vi.advanceTimersByTime(1000);});expect(fn).toHaveBeenCalledTimes(1);h.unmount();
 });
 it('shared room is joined once and last unmount removes it',()=>{
  const a=renderHook(()=>usePdvStoreEvents('s','sales_changed',()=>{}));const b=renderHook(()=>usePdvStoreEvents('s','live_changed',()=>{}));
  expect(mock.channel).toHaveBeenCalledTimes(1);a.unmount();expect(mock.remove).not.toHaveBeenCalled();b.unmount();expect(mock.remove).toHaveBeenCalledTimes(1);
 });
 it('domain filtering and reconnect avoid an unnecessary initial reload',()=>{
  const fn=vi.fn();const h=renderHook(()=>usePdvStoreEvents('s','live_changed',fn));
  act(()=>{mock.subscribe?.('SUBSCRIBED');mock.handlers.sales_changed();vi.advanceTimersByTime(1000);});expect(fn).not.toHaveBeenCalled();
  act(()=>{mock.subscribe?.('SUBSCRIBED');vi.advanceTimersByTime(1000);});expect(fn).toHaveBeenCalledTimes(1);h.unmount();
 });
});
