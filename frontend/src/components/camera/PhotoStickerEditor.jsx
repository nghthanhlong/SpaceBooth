import { useEffect, useId, useState } from 'react';
import { FACE_STICKERS } from '../../data/stickers';
import { EFFECT_BY_ID } from '../../data/faceEffects';
import { insertPhotoSticker, renderPhotoStickers } from '../../utils/photoStickers';
import './photo-sticker-editor.css';

const clampPercent = value => Math.max(0, Math.min(100, Math.round(Number(value))));
export function adjustmentFromPercent(kind, percent) {
  const n = percent === '' || !Number.isFinite(Number(percent)) ? 50 : clampPercent(percent);
  if (kind === 'scale') return n <= 50 ? .3 + n * .7 / 50 : 1 + (n - 50) / 50;
  return (n - 50) * (kind === 'angle' ? 1.8 : .016);
}
export function adjustmentToPercent(kind, value) {
  if (!Number.isFinite(value)) return 50;
  if (kind === 'scale') return clampPercent(value <= 1 ? (value - .3) * 50 / .7 : 50 + (value - 1) * 50);
  return clampPercent(50 + value / (kind === 'angle' ? 1.8 : .016));
}
function AdjustmentControl({ kind, label, value, disabled, onChange }) {
  const id = useId();
  const [draft, setDraft] = useState(null);
  const percent = adjustmentToPercent(kind, value);
  function commit() {
    onChange(adjustmentFromPercent(kind, draft ?? percent));
    setDraft(null);
  }
  return <div className="photo-sticker-editor__control">
    <div className="photo-sticker-editor__control-heading">
      <label htmlFor={id}>{label}</label>
      <input
        type="number" min="0" max="100" step="1" inputMode="numeric"
        aria-label={`${label}: nhập số từ 0 đến 100`}
        value={draft ?? percent} disabled={disabled}
        onFocus={e => { setDraft(String(percent)); e.currentTarget.select(); }}
        onChange={e => {
          const text = e.target.value;
          if (text === '') { setDraft(''); return; }
          const n = Number(text);
          if (!Number.isFinite(n)) return;
          const next = clampPercent(n);
          setDraft(String(next)); onChange(adjustmentFromPercent(kind, next));
        }}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
    </div>
    <input id={id} type="range" min="0" max="100" step="1" value={percent} disabled={disabled}
      onChange={e => { setDraft(null); onChange(adjustmentFromPercent(kind, e.target.value)); }} />
  </div>;
}

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
    <div className="photo-sticker-editor__workspace">
      <aside className="photo-sticker-editor__selection" aria-label="Chọn sticker cần chỉnh">
        <h3>Sticker cần chỉnh</h3>
    <div className="photo-sticker-editor__items">
      {items.map(e=><div key={e.id}><button type="button" disabled={disabled} aria-pressed={activeId===e.id} onClick={()=>setActiveId(e.id)} data-cv-selectable>{FACE_STICKERS.find(s=>s.id===e.kind)?.name}</button><button type="button" disabled={disabled} aria-label="Xóa sticker bổ sung này" onClick={()=>replace(items.filter(item=>item.id!==e.id))} data-cv-selectable>×</button></div>)}
    </div>
        {!items.length && <p>Chưa thêm sticker.</p>}
      </aside>
    <button className="photo-sticker-editor__image" type="button" disabled={disabled||!active} aria-label="Đặt sticker tại vị trí trên ảnh" onClick={e=>{
      const r=e.currentTarget.getBoundingClientRect(), x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
      const target=photo.faces?.find(f=>f.id===active.faceId);
      const cx=target?(target.landmarks[33].x+target.landmarks[263].x)/2:.5;
      const cy=target?(target.landmarks[33].y+target.landmarks[263].y)/2:.4;
      update({dx:x-cx,dy:y-cy});
    }}><img src={preview?.photo===photo&&preview.edits===edits?preview.url:photo.previewUrl} alt="Ảnh chỉnh sticker"/></button>
      <aside className="photo-sticker-editor__settings" aria-label="Thông số căn chỉnh sticker">
        <h3>Căn chỉnh</h3>
    {active&&<div className="photo-sticker-editor__adjust">
      {[['scale','Kích thước'],['angle','Xoay'],['dx','Ngang'],['dy','Dọc']].map(([kind,label]) => (
        <AdjustmentControl key={`${active.id}-${kind}`} kind={kind} label={label} value={active[kind]} disabled={disabled} onChange={value=>update({[kind]:value})} />
      ))}
      <button type="button" disabled={disabled} onClick={()=>update({scale:1,angle:0,dx:0,dy:0})} data-cv-selectable>Căn lại</button>
    </div>}
        {!active && <p>Chọn sticker bên trái để chỉnh.</p>}
      </aside>
    </div>
  </section>;
}
