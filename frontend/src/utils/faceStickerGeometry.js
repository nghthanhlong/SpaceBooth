import { STICKER_SLOTS as ORIGINAL_SLOTS, placeSticker as originalPose } from 'spacebooth-cv';
import { EFFECT_BY_ID } from '../data/faceEffects';
export const STICKER_SLOTS = {...ORIGINAL_SLOTS, ...Object.fromEntries(Object.values(EFFECT_BY_ID).map(e=>[e.id,e.slot]))};
export const stickerSlots = kind => kind==='gojo' ? ['head','eyes'] : [STICKER_SLOTS[kind]];
export const slotsOverlap = (a,b) => stickerSlots(a).some(slot => stickerSlots(b).includes(slot));
export const pixel = (p,s)=>({x:p.x*s.width,y:p.y*s.height});
export function faceFrame(face,size) {
  const lm=face?.landmarks;
  if (!lm || !lm[263] || !lm[33] || !lm[10] || !lm[152]) return null;
  let a=pixel(lm[33],size), b=pixel(lm[263],size);
  if(a.x>b.x) [a,b]=[b,a];
  const d=Math.hypot(b.x-a.x,b.y-a.y);
  if(!Number.isFinite(d)||d<2) return null;
  const angle=Math.atan2(b.y-a.y,b.x-a.x), c=Math.cos(angle), sn=Math.sin(angle);
  const x=(a.x+b.x)/2,y=(a.y+b.y)/2;
  return {x,y,d,angle,c,sn,local:(index)=>{const p=pixel(lm[index]??lm[168],size),dx=p.x-x,dy=p.y-y;return {x:(dx*c+dy*sn)/d,y:(-dx*sn+dy*c)/d};},world:(lx,ly)=>({x:x+d*(lx*c-ly*sn),y:y+d*(lx*sn+ly*c)})};
}
export function placeSticker(face,kind,size) {
  if(!EFFECT_BY_ID[kind]) return originalPose(face,kind,size);
  const f=faceFrame(face,size);
  return f?{x:f.x,y:f.y,width:f.d,angle:f.angle}:{x:NaN,y:NaN,width:0,angle:0};
}
export function findSmartSnapTarget(faces,kind,size,point=null) {
  let best=null;
  for(const face of faces??[]) {
    if(face.stale||!faceFrame(face,size)) continue;
    const placement=placeSticker(face,kind,size);
    const distance=point?Math.hypot(point.x-placement.x,point.y-placement.y):-faceFrame(face,size).d;
    if(!best||distance<best.distance) best={face,placement,distance};
  }
  return best;
}
export function findSnapTarget(point,faces,kind,size) {
  const result=findSmartSnapTarget(faces,kind,size,point);
  return result && result.distance<faceFrame(result.face,size).d*1.8?result:null;
}
// Compute transparent sprite bounds once, never read pixels during the render loop.
export function prepareSprite(image,kind) {
  if (typeof document === 'undefined') return image;
  const w=image.naturalWidth,h=image.naturalHeight;
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const data=ctx.getImageData(0,0,w,h).data;
  const bounds=(start,end)=>{let x0=w,y0=h,x1=0,y1=0;
    for(let y=0;y<h;y++)for(let x=start;x<end;x++)if(data[(y*w+x)*4+3]>24){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    return x1>=x0&&y1>=y0?{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1}:{x:0,y:0,w,h};};
  image.faceBounds=bounds(0,w);image.faceHalves=[bounds(0,Math.floor(w/2)),bounds(Math.floor(w/2),w)];
  if(kind==='gojo'){
    const b=image.faceBounds,rows=[];
    // Dense dark rows identify the cloth, excluding thin dark hair outlines.
    for(let y=Math.floor(b.y+b.h*.42);y<b.y+b.h;y++){
      let count=0,left=w,right=0;
      for(let x=b.x;x<b.x+b.w;x++){
        const k=(y*w+x)*4;
        if(data[k+3]>160&&data[k]+data[k+1]+data[k+2]<340){count++;left=Math.min(left,x);right=Math.max(right,x);}
      }
      rows.push({y,count,left,right});
    }
    const maximum=Math.max(0,...rows.map(row=>row.count));
    const band=rows.filter(row=>row.count>Math.max(b.w*.22,maximum*.40));
    if(band.length){
      const histogram=new Uint32Array(b.w);let total=0;
      for(const row of band)for(let x=b.x;x<b.x+b.w;x++){
        const k=(row.y*w+x)*4;
        if(data[k+3]>160&&data[k]+data[k+1]+data[k+2]<340){histogram[x-b.x]++;total++;}
      }
      const quantile=q=>{let count=0;for(let x=0;x<histogram.length;x++){count+=histogram[x];if(count>=total*q)return b.x+x;}return b.x+b.w-1;};
      const x=quantile(.02),right=quantile(.98);
      image.faceBandBounds={x,y:band[0].y,w:right-x+1,h:band.at(-1).y-band[0].y+1};
    }
  }
  return image;
}
const boundsOf=image=>image.faceBounds??{x:0,y:0,w:image.naturalWidth,h:image.naturalHeight};
export function drawFaceSticker(ctx,kind,image,pose,size,face) {
  const e=EFFECT_BY_ID[kind];
  if(!e) return false;
  if(e.type==='warp'||e.type==='bald') return true;
  const f=faceFrame(face,size);
  // Retain the last local landmark layout for the existing brief tracking fallback.
  if(f) image.faceLayouts??=new Map();
  const key=face?.id??pose.faceId;
  let layout=f?Object.fromEntries([1,10,13,14,61,291,78,308,152,234,454,127,356,0,17,172,397,176,400].map(i=>[i,f.local(i)])):image.faceLayouts?.get(key);
  if(f) {
    image.faceLayouts.delete(key);
    image.faceLayouts.set(key,layout);
    while(image.faceLayouts.size>32) image.faceLayouts.delete(image.faceLayouts.keys().next().value);
  }
  if(!layout) return true;
  const b=boundsOf(image);
  ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.angle);ctx.scale(pose.width,pose.width);
  const sprite=(box,x,y,w,h)=>ctx.drawImage(image,box.x,box.y,box.w,box.h,x,y,w,h);
  const full=(x,y,w,h=w*b.h/b.w)=>sprite(b,x,y,w,h);
  const forehead=layout[10];
  if(e.type==='hair') {
    const faceWidth=Math.abs(layout[454].x-layout[234].x);
    if(kind==='gojo'){
      // One original-style image: keep the hair/cloth join and anchor its cloth to the eyes.
      const band=image.faceBandBounds??{x:b.x+b.w*.16,y:b.y+b.h*.67,w:b.w*.68,h:b.h*.31};
      const bandWidth=Math.max(1.56,faceWidth*.97),w=bandWidth*b.w/band.w,h=w*b.h/b.w;
      const centerX=(band.x+band.w/2-b.x)/b.w,centerY=(band.y+band.h/2-b.y)/b.h;
      full(-centerX*w,-.12-centerY*h,w,h);
    }else{
      // Draw only the alpha PNG. No ellipse, rear cap or extra color layer.
      const w=kind==='ayanokoji'?Math.max(2.67,faceWidth*1.67):kind==='goku-purple'?Math.max(3.42,faceWidth*2.13):Math.max(2.62,faceWidth*1.63);
      const h=w*b.h/b.w*(kind==='ayanokoji'?.96:1);
      const hairline=kind==='ayanokoji'?.50:.72;
      full(forehead.x-w/2,forehead.y-h*hairline-(kind==='ayanokoji'?.12:0),w,h);
    }
  } else if(e.type==='horns') {
    const halves=image.faceHalves??[{...b,w:b.w/2},{...b,x:b.x+b.w/2,w:b.w/2}];
    const faceWidth=Math.abs(layout[454].x-layout[234].x);
    const separation=Math.max(1.18,faceWidth*.78),w=.77;
    halves.forEach((box,i)=>{const h=w*box.h/box.w,center=forehead.x+(i===0?-1:1)*separation/2;
      sprite(box,center-w/2,forehead.y-.10-h,w,h);});
  } else if(e.type==='elf') {
    const points=[layout[127],layout[356]].sort((a,b)=>a.x-b.x);
    const halves=image.faceHalves??[{...b,w:b.w/2},{...b,x:b.x+b.w/2,w:b.w/2}];
    points.forEach((p,i)=>{const box=halves[i],w=.64,h=w*box.h/box.w;
      // Overlap the natural ear instead of leaving the elf ear outside it.
      // Trim only the innermost bulb, keeping the broad root over the real ear.
      const x=i===0?p.x-w+.16:p.x-.16;
      const inner=p.x+(i===0?.13:-.13);
      ctx.save();ctx.beginPath();ctx.rect(i===0?inner-w-.05:inner,p.y-2,w+.05,4);ctx.clip();
      // Remove just the small face-facing lobe tip, leaving the upper root over the real ear.
      ctx.beginPath();ctx.rect(-4,-4,8,8);
      ctx.rect(i===0?p.x+.035:p.x-.335,p.y+.10,.30,.22);ctx.clip('evenodd');
      sprite(box,x,p.y+.20-h*.75,w,h);ctx.restore();});
  } else if(e.type==='cat') {
    const halves=image.faceHalves??[{...b,w:b.w/2},{...b,x:b.x+b.w/2,w:b.w/2}];
    halves.forEach((box,i)=>{const w=.64,h=w*box.h/box.w;sprite(box,forehead.x+(i===0?-.88:.24),forehead.y-.24-h,w,h);});
    const nose=layout[1];
    ctx.fillStyle='#f3a5bf';ctx.strokeStyle='#4d304c';ctx.lineWidth=.018;
    ctx.beginPath();ctx.moveTo(nose.x-.095,nose.y-.035);ctx.quadraticCurveTo(nose.x,nose.y-.09,nose.x+.095,nose.y-.035);ctx.lineTo(nose.x,nose.y+.055);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(nose.x,nose.y+.04);ctx.lineTo(nose.x,nose.y+.15);
    for(const side of [-1,1])for(let row=-1;row<=1;row++){ctx.moveTo(nose.x+side*.13,nose.y+.08+row*.05);ctx.lineTo(nose.x+side*.57,nose.y+.08+row*.15);}
    ctx.stroke();
  } else if(e.type==='fangs') {
    const mouth=[layout[61],layout[291]].sort((a,b)=>a.x-b.x);
    const mw=Math.hypot(mouth[1].x-mouth[0].x,mouth[1].y-mouth[0].y);
    const mouthAngle=Math.atan2(mouth[1].y-mouth[0].y,mouth[1].x-mouth[0].x);
    const top=layout[13],gap=Math.abs(layout[14].y-top.y);
    const len=Math.max(mw*.16,Math.min(mw*.32,gap*.8+mw*.14));
    ctx.save();ctx.translate(top.x,top.y-.018);ctx.rotate(mouthAngle);
    for(const side of [-1,1]){const x=side*mw*.28,w=mw*.12;
      ctx.beginPath();ctx.moveTo(x-w/2,0);ctx.lineTo(x+w/2,0);ctx.quadraticCurveTo(x+w*.45,len*.6,x,len);ctx.quadraticCurveTo(x-w*.45,len*.55,x-w/2,0);ctx.fillStyle='#fffdf4';ctx.fill();ctx.lineWidth=.008;ctx.strokeStyle='#c6afb7';ctx.stroke();}
    ctx.restore();
  } else if(e.type==='beard') {
    const mouth=layout[13],chin=layout[152];
    const faceWidth=Math.abs(layout[454].x-layout[234].x);
    const w=Math.max(1.05,faceWidth*.94),mouthAt=kind==='beard-bold'?.36:.29;
    const below=Math.max(.34,chin.y-mouth.y+.13);
    const h=kind==='beard-bold'?below/(1-mouthAt):w*b.h/b.w;
    const y=mouth.y-h*mouthAt;
    ctx.save();
    // Preserve the real mouth rather than assuming the sprite's hole fits every lip shape.
    const a=layout[61],z=layout[291],upper=layout[0],lower=layout[17];
    ctx.beginPath();ctx.rect(-4,-4,8,8);
    ctx.moveTo(a.x-.025,a.y);ctx.quadraticCurveTo(upper.x,Math.min(upper.y,mouth.y)-.015,z.x+.025,z.y);
    ctx.quadraticCurveTo(lower.x,Math.max(lower.y,layout[14].y)+.025,a.x-.025,a.y);ctx.closePath();
    ctx.clip('evenodd');full(mouth.x-w/2,y,w,h);ctx.restore();
  }
  ctx.restore();return true;
}
