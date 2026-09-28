let csrf='';
export function setCsrf(value){csrf=value||'';}
export async function api(url,options={}){
  const {body,...rest}=options;
  const response=await fetch(`/api${url}`,{credentials:'same-origin',...rest,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...rest.headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if(!response.ok||!result.success){if(response.status===401&&!url.includes('/auth/login'))window.dispatchEvent(new Event('session-expired'));throw Object.assign(new Error(result.error?.message||'Request failed.'),{code:result.error?.code,status:response.status});}
  return result;
}
export const queryString=obj=>new URLSearchParams(Object.entries(obj).filter(([,v])=>v!==undefined&&v!==null&&v!=='')).toString();
export function messageFor(k,s){return s.template.replace(/\{(key|type|duration|maxDevices|contact)\}/g,(_,f)=>({key:k.key,type:k.type,duration:k.expiresAt===0?'Lifetime':`${Math.max(0,Math.round((k.expiresAt-k.createdAt)/86400000*100)/100)} Days`,maxDevices:k.maxDevices,contact:s.contact})[f]);}
export function download(text,name,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
