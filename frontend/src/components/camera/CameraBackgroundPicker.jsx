import { useEffect, useRef, useState } from 'react';
import { BACKGROUNDS } from '../layout/BackgroundPicker';

export default function CameraBackgroundPicker({value,onChange,disabled}) {
  const [open,setOpen]=useState(false),root=useRef(null),button=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const close=e=>{if(!root.current?.contains(e.target))setOpen(false);};
    const key=e=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};
  },[open]);
  const choices=[{id:'none',name:'Nền thật'},...BACKGROUNDS.map(item=>({...item,name:item.id==='snow'?'Tuyết (tĩnh)':item.name}))];
  return <div className="background-picker" ref={root}>
    <button ref={button} type="button" className="secondary-button" disabled={disabled} aria-expanded={open} aria-controls="camera-background-options" onClick={()=>setOpen(!open)} data-cv-selectable>
      Chụp với nền{value==='none'?'':`: ${choices.find(item=>item.id===value)?.name}`}
    </button>
    {open&&<div id="camera-background-options" role="group" aria-label="Chọn nền webcam" className="background-picker__menu">
      {choices.map(item=><button key={item.id} type="button" disabled={disabled} aria-pressed={value===item.id} onClick={()=>{onChange(item.id);setOpen(false);button.current?.focus();}} data-cv-selectable>
        <span className="background-picker__swatch" style={item.image?{backgroundImage:`url(${import.meta.env.BASE_URL}backgrounds/${item.image})`}:{backgroundColor:item.color??'#475569'}}/>
        <span>{item.name}</span><span aria-hidden="true">{value===item.id?'✓':''}</span>
      </button>)}
    </div>}
  </div>;
}
