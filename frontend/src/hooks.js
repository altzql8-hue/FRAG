import {useEffect,useState} from 'react';
import {api} from './api';
export function useRequest(url,revision=0){const [state,setState]=useState({loading:true,data:null,error:''});useEffect(()=>{const controller=new AbortController();setState(s=>({...s,loading:true,error:''}));api(url,{signal:controller.signal}).then(data=>setState({loading:false,data,error:''})).catch(e=>{if(e.name!=='AbortError')setState({loading:false,data:null,error:e.message});});return()=>controller.abort();},[url,revision]);return state;}
export function useDebounce(value,delay=300){const [v,set]=useState(value);useEffect(()=>{const t=setTimeout(()=>set(value),delay);return()=>clearTimeout(t);},[value,delay]);return v;}
