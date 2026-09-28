import React,{useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,ChevronsLeft,ChevronsRight,KeyRound,LoaderCircle,X} from 'lucide-react';
export function Button({busy,children,className='',...props}){return <button {...props} disabled={busy||props.disabled} className={`button ${className}`}>{busy&&<LoaderCircle className="spin" size={16}/>} {children}</button>;}
export function Field({label,help,children,...props}){return <label className="field"><span>{label}</span>{children||<input {...props}/>} {help&&<small>{help}</small>}</label>;}
export function Panel({title,subtitle,actions,children,className=''}){return <section className={`panel ${className}`}>{title&&<div className="panel-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{actions}</div>}{children}</section>;}
export function Empty({title='No results',text='Try adjusting your filters.',children}){return <div className="empty"><KeyRound size={34}/><strong>{title}</strong><p>{text}</p>{children}</div>;}
export function Skeleton(){return <div className="skeleton" aria-label="Loading" role="status"><div/><div/><div/></div>;}
export function Badge({status}){const text=status==='banned'?'revoked':status;return <span className={`badge ${status}`}>{text||'unknown'}</span>;}
export function Modal({title,children,onClose,wide=false}){
  const ref=useRef();
  useEffect(()=>{const el=ref.current;el.showModal();return()=>el.close();},[]);
  return <dialog ref={ref} className={wide?'wide':''} onCancel={e=>{e.preventDefault();onClose();}}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X/></button></div>{children}</dialog>;
}
export function Confirm({title,text,danger=false,requireText,onConfirm,onClose,children}){
  const [typed,setTyped]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title={title} onClose={()=>!busy&&onClose()}><p>{text}</p>{children}{requireText&&<Field label={`Type ${requireText} to confirm`} value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off"/>}{error&&<p className="error" role="alert">{error}</p>}<div className="dialog-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button className={danger?'danger':'primary'} disabled={requireText&&typed!==requireText} busy={busy} onClick={async()=>{setBusy(true);try{await onConfirm(typed);onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}}>Confirm</Button></div></Modal>;
}
export function Pagination({p,onPage,onLimit}){
  if(!p)return null;
  const start=Math.max(1,Math.min(p.page-2,p.totalPages-4)),numbers=Array.from({length:Math.min(5,p.totalPages)},(_,i)=>start+i);
  return <div className="pagination"><span>Showing {p.total?(p.page-1)*p.limit+1:0}–{Math.min(p.page*p.limit,p.total)} of {p.total.toLocaleString()}</span><div className="page-controls"><button aria-label="First page" disabled={!p.hasPrevious} onClick={()=>onPage(1)}><ChevronsLeft size={16}/></button><button aria-label="Previous page" disabled={!p.hasPrevious} onClick={()=>onPage(p.page-1)}><ChevronLeft size={16}/></button>{numbers.map(n=><button className={`page-number ${n===p.page?'selected':''}`} key={n} onClick={()=>onPage(n)} aria-label={`Page ${n}`} aria-current={n===p.page?'page':undefined}>{n}</button>)}<span className="mobile-page">{p.page} / {p.totalPages}</span><button aria-label="Next page" disabled={!p.hasNext} onClick={()=>onPage(p.page+1)}><ChevronRight size={16}/></button><button aria-label="Last page" disabled={!p.hasNext} onClick={()=>onPage(p.totalPages)}><ChevronsRight size={16}/></button><label className="goto">Go to <input aria-label="Go to page" type="number" min="1" max={p.totalPages} defaultValue={p.page} key={p.page} onKeyDown={e=>{if(e.key==='Enter'){const n=Number(e.currentTarget.value);if(n>=1&&n<=p.totalPages)onPage(n);}}}/></label><select aria-label="Rows per page" value={p.limit} onChange={e=>onLimit(Number(e.target.value))}>{[10,25,50,100].map(n=><option key={n} value={n}>{n} / page</option>)}</select></div></div>;
}
export function PageHeading({title,subtitle,children}){return <div className="page-heading"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div><div className="heading-actions">{children}</div></div>;}
