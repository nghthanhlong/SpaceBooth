import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/backgrounds.css';

export const BACKGROUNDS = [
  {id:'dark', name:'Đen', color:'#0f172a'},
  {id:'white', name:'Trắng', color:'#f8fafc'},
  {id:'cyberpunk', name:'Cyberpunk', image:'cyberpunk.png'},
  {id:'sakura', name:'Hoa anh đào', image:'sakura.png'},
  {id:'snow', name:'Tuyết rơi', image:'snow-village.png'},
];
const STORAGE_KEY='spacebooth.background';
export function validBackground(value) {
  return BACKGROUNDS.some(item=>item.id===value)?value:'dark';
}
export function readBackground(storage) {
  try {return validBackground((storage ?? localStorage).getItem(STORAGE_KEY));} catch {return 'dark';}
}
export function saveBackground(value, storage) {
  try {(storage ?? localStorage).setItem(STORAGE_KEY,validBackground(value));} catch { /* Selection still works when storage is blocked. */ }
}
export default function BackgroundPicker() {
  const [selected,setSelected]=useState(() => readBackground());
  const [open,setOpen]=useState(false);
  const root=useRef(null),trigger=useRef(null);
  const current=BACKGROUNDS.find(item=>item.id===selected);
  useEffect(()=>{
    document.documentElement.dataset.background=selected;
    saveBackground(selected);
  },[selected]);
  useEffect(()=>{
    if(!open)return;
    function outside(event){if(!root.current?.contains(event.target))setOpen(false);}
    function key(event){if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}}
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
  },[open]);
  return <>
    {createPortal(<div className={`booth-backdrop booth-backdrop--${selected}`} aria-hidden="true">
      {selected==='snow'&&<div className="booth-snow"><i/><i/><i/></div>}
    </div>,document.body)}
    <div className="background-picker" ref={root}>
      <button ref={trigger} type="button" className="secondary-button background-picker__trigger"
        aria-expanded={open} aria-controls="booth-background-options" onClick={()=>setOpen(value=>!value)} data-cv-selectable>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>
        Nền: {current.name}
      </button>
      {open&&<div id="booth-background-options" className="background-picker__menu" role="group" aria-label="Chọn nền giao diện">
        {BACKGROUNDS.map(item=><button type="button" key={item.id} aria-pressed={selected===item.id}
          onClick={()=>{setSelected(item.id);setOpen(false);trigger.current?.focus();}} data-cv-selectable>
          <span className="background-picker__swatch" style={item.image?{backgroundImage:`url(${import.meta.env.BASE_URL}backgrounds/${item.image})`}:{backgroundColor:item.color}}/>
          <span>{item.name}</span><span aria-hidden="true">{selected===item.id?'✓':''}</span>
        </button>)}
      </div>}
    </div>
  </>;
}
