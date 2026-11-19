import { useEffect, useState } from 'react';
import { FACE_STICKERS } from '../../data/stickers';
import { EFFECT_BY_ID } from '../../data/faceEffects';
import { insertPhotoSticker, renderPhotoStickers } from '../../utils/photoStickers';
import './photo-sticker-editor.css';

export function NoStickerIcon() {
  return <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" strokeWidth="5"/><path d="M8 40 40 8" stroke="#1e293b" strokeWidth="11"/><path d="M8 40 40 8" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/></svg>;
}
export default function PhotoStickerEditor({ photos, edits, onChange, disabled }) {
  const [photoId,setPhotoId]=useState(photos[0]?.id);
  const photo=photos.find(p=>p.id===photoId)??photos[0];
  const [faceId,setFaceId]=useState(null), [activeId,setActiveId]=useState(null);
  const [preview,setPreview]=useState(null), [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const items=edits[photo?.id]??[];
  const active=items.find(e=>e.id===activeId);
  const face=photo?.faces?.find(f=>f.id===faceId)??photo?.faces?.[0];
  useEffect(()=>{
    let valid=true;
    const timer=setTimeout(()=>{setBusy(true);setError('');renderPhotoStickers(photo,edits[photo.id]).then(url=>{if(valid)setPreview({photo,edits,url});}).catch(e=>{if(valid)setError(e.message);}).finally(()=>{if(valid)setBusy(false);});},100);
    return()=>{valid=false;clearTimeout(timer);};
  },[photo,edits]);
  function replace(next) { onChange({...edits,[photo.id]:next}); }
  function update(patch) { replace(items.map(e=>e.id===activeId?{...e,...patch}:e)); }
  function add(kind) {
    const item={id:crypto.randomUUID(),kind,faceId:face?.id??null,scale:1,angle:0,dx:0,dy:0};
    replace(insertPhotoSticker(items,item));setActiveId(item.id);
  }
  return <section className="photo-sticker-editor" aria-label="Bổ sung sticker vào ảnh">
    <div className="photo-sticker-editor__photos" role="group" aria-label="Ảnh cần chỉnh">
      {photos.map((p,i)=><button key={p.id} type="button" disabled={disabled} aria-pressed={p.id===photo.id} onClick={()=>{setPhotoId(p.id);setActiveId(null);setFaceId(null);}} data-cv-selectable>Ảnh {i+1}</button>)}
    </div>
    {!!photo.faces?.length && <label>Khuôn mặt <select value={face?.id??''} disabled={disabled} onChange={e=>setFaceId(photo.faces.find(f=>String(f.id)===e.target.value)?.id)}>{photo.faces.map((f,i)=><option key={f.id} value={f.id}>Mặt {i+1}</option>)}</select></label>}
    <div className="photo-sticker-editor__catalog" role="group" aria-label="Sticker bổ sung">
      <button type="button" aria-label="Không thêm sticker; xóa sticker bổ sung trên ảnh này" title="Xóa sticker bổ sung" aria-pressed={!items.length} disabled={disabled||!items.length} onClick={()=>{replace([]);setActiveId(null);}} data-cv-selectable><NoStickerIcon/></button>
      {FACE_STICKERS.map(s=>{
        const needsFace=['warp','bald'].includes(EFFECT_BY_ID[s.id]?.type);
        return <button key={s.id} type="button" disabled={disabled||(needsFace&&!face)} title={needsFace&&!face?'Hiệu ứng cần ảnh mới có dữ liệu khuôn mặt':s.name} aria-label={s.name} onClick={()=>add(s.id)} data-cv-selectable><img src={s.src} alt=""/><span>{s.name}</span></button>;
      })}
    </div>
    <p>{face?'Sticker tự căn theo mặt. Chọn sticker đang thêm rồi bấm trên ảnh để dịch vị trí.':'Chọn sticker rồi bấm trên ảnh để đặt vị trí tùy ý.'}</p>
    {error&&<p role="alert">{error}</p>}
    {busy&&<p role="status">Đang cập nhật ảnh…</p>}
    <button className="photo-sticker-editor__image" type="button" disabled={disabled||!active} aria-label="Đặt sticker tại vị trí trên ảnh" onClick={e=>{
      const r=e.currentTarget.getBoundingClientRect(), x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
      const target=photo.faces?.find(f=>f.id===active.faceId);
      const cx=target?(target.landmarks[33].x+target.landmarks[263].x)/2:.5;
      const cy=target?(target.landmarks[33].y+target.landmarks[263].y)/2:.4;
      update({dx:x-cx,dy:y-cy});
    }}><img src={preview?.photo===photo&&preview.edits===edits?preview.url:photo.previewUrl} alt="Ảnh chỉnh sticker"/></button>
    <div className="photo-sticker-editor__items">
      {items.map(e=><div key={e.id}><button type="button" disabled={disabled} aria-pressed={activeId===e.id} onClick={()=>setActiveId(e.id)} data-cv-selectable>{FACE_STICKERS.find(s=>s.id===e.kind)?.name}</button><button type="button" disabled={disabled} aria-label="Xóa sticker bổ sung này" onClick={()=>replace(items.filter(item=>item.id!==e.id))} data-cv-selectable>×</button></div>)}
    </div>
    {active&&<div className="photo-sticker-editor__adjust">
      <label>Kích thước <input type="range" min="0.3" max="2" step="0.05" value={active.scale} disabled={disabled} onChange={e=>update({scale:Number(e.target.value)})}/></label>
      <label>Xoay <input type="range" min="-90" max="90" value={active.angle} disabled={disabled} onChange={e=>update({angle:Number(e.target.value)})}/></label>
      <label>Ngang <input type="range" min="-0.8" max="0.8" step="0.01" value={active.dx} disabled={disabled} onChange={e=>update({dx:Number(e.target.value)})}/></label>
      <label>Dọc <input type="range" min="-0.8" max="0.8" step="0.01" value={active.dy} disabled={disabled} onChange={e=>update({dy:Number(e.target.value)})}/></label>
      <button type="button" disabled={disabled} onClick={()=>update({scale:1,angle:0,dx:0,dy:0})} data-cv-selectable>Căn lại</button>
    </div>}
  </section>;
}
