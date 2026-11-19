import { FACE_STICKERS } from '../data/stickers';
import { EFFECT_BY_ID } from '../data/faceEffects';
import { drawFaceSticker, placeSticker, prepareSprite, slotsOverlap } from './faceStickerGeometry';
import { createControls, FaceWarpRenderer, warpPoint } from './faceWarp';
import { BaldRenderer } from './baldRenderer';

const sprites = new Map();
const renderedPhotos = new WeakMap();
const EMPTY_EDITS = [];
async function load(src) {
  const image = new Image(); image.src = src; await image.decode(); return image;
}
async function sprite(kind) {
  if (!sprites.has(kind)) {
    const item = FACE_STICKERS.find(s => s.id === kind);
    if (!item) throw new Error('Sticker không tồn tại.');
    const task = load(item.src).then(image => prepareSprite(image, kind));
    sprites.set(kind, task);
    task.catch(() => sprites.delete(kind));
  }
  return sprites.get(kind);
}
export function insertPhotoSticker(items, item) {
  return [...items.filter(old => old.faceId !== item.faceId || !slotsOverlap(old.kind, item.kind)), item];
}
export function adjustedFace(face, edit, size = {width:1,height:1}) {
  const eyeA = face.landmarks[33], eyeB = face.landmarks[263];
  const x = (eyeA.x + eyeB.x) / 2, y = (eyeA.y + eyeB.y) / 2;
  const a=edit.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return {...face, landmarks: face.landmarks.map(p => {
    const px=(p.x-x)*size.width*edit.scale,py=(p.y-y)*size.height*edit.scale;
    return {...p,x:x+(px*c-py*s)/size.width+edit.dx,y:y+(px*s+py*c)/size.height+edit.dy};
  })};
}
export function renderPhotoStickers(photo, edits = EMPTY_EDITS) {
  let cache=renderedPhotos.get(photo);
  if(!cache){cache=new WeakMap();renderedPhotos.set(photo,cache);}
  if(!cache.has(edits)){
    const task=renderPhoto(photo,edits);cache.set(edits,task);
    task.catch(()=>cache.delete(edits));
  }
  return cache.get(edits);
}
async function renderPhoto(photo, edits) {
  const image = await load(photo.previewUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không thể chỉnh ảnh.');
  ctx.drawImage(image, 0, 0);
  const size = {width:canvas.width, height:canvas.height};
  const faces = photo.faces ?? [];
  const effectFaces = new Map();
  const controls = [];
  for (const edit of edits) {
    const source = faces.find(f => f.id === edit.faceId);
    if (!source) continue;
    const face = adjustedFace(source, edit, size); effectFaces.set(edit.id, face);
    if (EFFECT_BY_ID[edit.kind]?.type === 'warp') controls.push(...createControls(face, edit.kind, size));
  }
  if (controls.length) {
    const renderer = new FaceWarpRenderer();
    try { renderer.render(ctx, size, controls); } finally { renderer.dispose(); }
  }
  const transformed = face => !controls.length ? face : ({...face, landmarks:face.landmarks.map(p => {
    const q=warpPoint({x:p.x*size.width,y:p.y*size.height},controls);
    return {...p,x:q.x/size.width,y:q.y/size.height};
  })});
  for (const edit of edits.filter(e => e.kind === 'bald')) {
    const face = effectFaces.get(edit.id);
    if (!face) throw new Error('Ảnh này chưa có vị trí mặt để áp dụng Hói đầu.');
    const renderer = new BaldRenderer();
    try {
      const start=performance.now(), f=transformed(face);
      while (!renderer.hasMask(f.id)) {
        if (renderer.status === 'error' || performance.now()-start > 20000) throw new Error('Không nhận diện được vùng tóc. Hãy bỏ Hói đầu rồi thử lại.');
        renderer.render(ctx,size,[f]);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      renderer.render(ctx,size,[f],{snapshot:true});
    } finally { renderer.dispose(); }
  }
  for (const edit of edits) {
    const type = EFFECT_BY_ID[edit.kind]?.type;
    if (type === 'warp' || type === 'bald') continue;
    const icon = await sprite(edit.kind);
    const source = effectFaces.get(edit.id);
    ctx.save();
    if (source) {
      const face = transformed(source), pose = placeSticker(face, edit.kind, size);
      if (!drawFaceSticker(ctx, edit.kind, icon, pose, size, face)) {
        const h=pose.width*icon.naturalHeight/icon.naturalWidth;
        ctx.translate(pose.x,pose.y); ctx.rotate(pose.angle);
        ctx.drawImage(icon,-pose.width/2,-h/2,pose.width,h);
      }
    } else {
      const w=canvas.width*.3*edit.scale,h=w*icon.naturalHeight/icon.naturalWidth;
      ctx.translate((.5+edit.dx)*canvas.width,(.4+edit.dy)*canvas.height);
      ctx.rotate(edit.angle*Math.PI/180); ctx.drawImage(icon,-w/2,-h/2,w,h);
    }
    ctx.restore();
  }
  return canvas.toDataURL('image/png');
}
export async function photosWithStickers(photos, edits) {
  return Promise.all(photos.map(async photo => edits[photo.id]?.length
    ? {...photo, previewUrl:await renderPhotoStickers(photo, edits[photo.id])} : photo));
}
