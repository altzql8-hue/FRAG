import React,{createContext,useContext,useState,useEffect,useCallback} from 'react';
import {api,setCsrf} from './api';
import {X,CheckCircle2,AlertCircle,Info} from 'lucide-react';
const Context=createContext();
export const useApp=()=>useContext(Context);
export function AppProvider({children}){
  const [session,setSession]=useState(null),[settings,setSettings]=useState(null),[loading,setLoading]=useState(true),[failure,setFailure]=useState(''),[toasts,setToasts]=useState([]),[online,setOnline]=useState(navigator.onLine);
  const toast=useCallback((message,type='success')=>{const id=crypto.randomUUID();setToasts(t=>[...t.slice(-3),{id,message,type}]);setTimeout(()=>setToasts(t=>t.filter(v=>v.id!==id)),6000);},[]);
  const refreshSettings=useCallback(async()=>{const r=await api('/settings');setSettings(r.data);return r.data;},[]);
  const acceptSession=useCallback(async s=>{setSession(s);setCsrf(s.csrf);if(!s.forceChange)await refreshSettings();},[refreshSettings]);
  const refresh=useCallback(async()=>{setLoading(true);setFailure('');try{await acceptSession((await api('/auth/session')).data);}catch(e){if(e.status!==401)setFailure(e.message);}finally{setLoading(false);}},[acceptSession]);
  useEffect(()=>{refresh();const expired=()=>{setSession(null);setCsrf('');};const on=()=>{setOnline(true);toast('Connection restored','info');};const off=()=>setOnline(false);window.addEventListener('session-expired',expired);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('session-expired',expired);window.removeEventListener('online',on);window.removeEventListener('offline',off);};},[refresh,toast]);
  const logout=async()=>{try{await api('/auth/logout',{method:'POST'});setSession(null);setSettings(null);setCsrf('');}catch(e){toast(e.message,'error');}};
  const copy=async text=>{try{await navigator.clipboard.writeText(text);toast('Copied to clipboard');return true;}catch{toast('Clipboard access was denied. Select and copy the text.','warning');return false;}};
  const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:settings?.dateFormat||'medium',timeStyle:'short',timeZone:settings?.timezone||'UTC'}).format(new Date(value)):'—';
  return <Context.Provider value={{session,setSession,settings,setSettings,loading,failure,refresh,acceptSession,refreshSettings,logout,toast,copy,date}}>{!online&&<div className="offline" role="status">Connection lost — changes require a connection</div>}{children}<div className="toasts" aria-live="polite">{toasts.map(t=><div className={`toast ${t.type}`} key={t.id}>{t.type==='error'?<AlertCircle size={19}/>:t.type==='info'?<Info size={19}/>:<CheckCircle2 size={19}/>}<span>{t.message}</span><button aria-label="Dismiss notification" onClick={()=>setToasts(v=>v.filter(x=>x.id!==t.id))}><X size={16}/></button></div>)}</div></Context.Provider>;
}
