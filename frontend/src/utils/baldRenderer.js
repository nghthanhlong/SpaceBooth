import { faceFrame } from './faceStickerGeometry';
const SIDE=256, SPAN=3.6, TOP=-2.0, LEFT=-SPAN/2;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];

export function sampleSkin(pixels,width,height,points){
  const samples=[[],[],[]];
  for(const p of points)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const x=clamp(Math.round(p.x)+dx,0,width-1),y=clamp(Math.round(p.y)+dy,0,height-1),n=(y*width+x)*4;
    const r=pixels[n],g=pixels[n+1],b=pixels[n+2];
    if(r+g+b<90 || r+g+b>735)continue;
    samples[0].push(r);samples[1].push(g);samples[2].push(b);
  }
  return samples[0].length?samples.map(median):[195,151,128];
}
// A local upright crop keeps the last mask attached when the head moves/rolls.
export function cropHead(ctx,size,face,canvas){
  const f=faceFrame(face,size);if(!f)return null;
  if(canvas.width!==SIDE||canvas.height!==SIDE){canvas.width=SIDE;canvas.height=SIDE;}
  const c=canvas.getContext('2d',{willReadFrequently:true});
  c.clearRect(0,0,SIDE,SIDE);
  c.save();c.translate(-LEFT*SIDE/SPAN,-TOP*SIDE/SPAN);c.scale(SIDE/(SPAN*f.d),SIDE/(SPAN*f.d));c.rotate(-f.angle);c.translate(-f.x,-f.y);c.drawImage(ctx.canvas,0,0);c.restore();
  return f;
}
export function normalizeHairMask(pixels,width,height){
  const output=new Uint8Array(SIDE*SIDE);
  // Dilate a tiny amount so dark edge pixels are also replaced.
  for(let y=0;y<SIDE;y++)for(let x=0;x<SIDE;x++){
    const sx=Math.floor(x*width/SIDE),sy=Math.floor(y*height/SIDE);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(pixels[clamp(sy+dy,0,height-1)*width+clamp(sx+dx,0,width-1)]===1)output[y*SIDE+x]=255;
  }
  return output;
}
export function paintScalp(source,mask,frame,output){
  const localToPixel=p=>({x:(p.x-LEFT)*SIDE/SPAN,y:(p.y-TOP)*SIDE/SPAN});
  const nose=frame.local(1),forehead=frame.local(10);
  const cheeks=[frame.local(234),frame.local(454)].sort((a,b)=>a.x-b.x);
  const skinPoints=cheeks.map(p=>localToPixel({x:nose.x+(p.x-nose.x)*.53,y:nose.y+.10}));
  const skin=sampleSkin(source,SIDE,SIDE,skinPoints);
  // Reuse forehead illumination across the new scalp instead of a flat cheek color.
  // Select bright skin samples to avoid bangs, eyebrows and eyeglass rims.
  const foreheadColumns=[];
  for(let col=0;col<SIDE;col++){
    const lx=LEFT+(col+.5)*SPAN/SIDE;
    const sampleX=localToPixel({x:forehead.x+clamp((lx-forehead.x)/.9,-1,1)*.34,y:0}).x;
    const candidates=[];
    const start=Math.floor(localToPixel({x:0,y:forehead.y+.12}).y);
    const end=Math.ceil(localToPixel({x:0,y:-.31}).y);
    for(let y=clamp(start,0,SIDE-1);y<=clamp(end,0,SIDE-1);y++)for(let dx=-1;dx<=1;dx++){
      const x=clamp(Math.round(sampleX)+dx,0,SIDE-1),n=y*SIDE+x,k=n*4;
      if(mask[n])continue;
      const rgb=[source[k],source[k+1],source[k+2]],light=rgb.reduce((a,b)=>a+b,0);
      if(light>skin.reduce((a,b)=>a+b,0)*.75 && light<710)candidates.push({rgb,light});
    }
    candidates.sort((a,b)=>b.light-a.light);
    const good=candidates.slice(0,Math.max(1,Math.ceil(candidates.length*.35)));
    foreheadColumns.push(good.length?[0,1,2].map(c=>good.reduce((sum,p)=>sum+p.rgb[c],0)/good.length):skin);
  }
  let hairTop=forehead.y-.50,found=false;
  const rows=[];
  for(let y=0;y<SIDE;y++){
    let first=SIDE,last=-1;
    for(let x=0;x<SIDE;x++)if(mask[y*SIDE+x] && Math.abs(LEFT+x*SPAN/SIDE-forehead.x)<1.18 && TOP+y*SPAN/SIDE<.18){first=Math.min(first,x);last=x;}
    rows.push([first,last]);
    if(last>=first && !found && last-first>3){hairTop=TOP+y*SPAN/SIDE;found=true;}
  }
  if(!found)return false;
  const cx=forehead.x,rx=clamp(Math.abs(cheeks[1].x-cheeks[0].x)*.57,.76,1.0);
  const cy=Math.min(-.28,forehead.y+.20),top=clamp(hairTop-.035,forehead.y-1.15,forehead.y-.45);
  const ry=Math.max(.65,cy-top),blendStart=forehead.y+.10,blendEnd=Math.min(-.13,forehead.y+.44);
  output.fill(0);
  for(let y=0;y<SIDE;y++)for(let x=0;x<SIDE;x++){
    const lx=LEFT+(x+.5)*SPAN/SIDE,ly=TOP+(y+.5)*SPAN/SIDE,n=y*SIDE+x,k=n*4;
    const ey=(ly-cy)/ry;
    const half=ly<cy?rx*Math.sqrt(Math.max(0,1-ey*ey)):rx;
    const edge=clamp((half-Math.abs(lx-cx))/(2*SPAN/SIDE)+.5,0,1);
    const blend=clamp((blendEnd-ly)/Math.max(.08,blendEnd-blendStart),0,1);
    const inScalp=ly>top-.025?edge*blend:0;
    const isHair=mask[n]/255 && Math.abs(lx-cx)<1.18 && ly<.18;
    if(!inScalp&&!isHair)continue;
    if(isHair && edge<.3){
      // Fill the small old-hair fringe outside the smooth scalp with nearby scene pixels.
      // This is local image inpainting, not a generated reconstruction of the background.
      const [a,b]=rows[y];let sx=x<(a+b)/2?a-4:b+4;sx=clamp(sx,0,SIDE-1);
      const j=(y*SIDE+sx)*4;
      output[k]=source[j];output[k+1]=source[j+1];output[k+2]=source[j+2];output[k+3]=255;
    }else{
      const shade=clamp(18*(1-((lx-cx)/rx)**2)*clamp((blendEnd-ly)/1.1,0,1)-9*((lx-cx)/rx)**2,-12,18);
      const shine=28*Math.exp(-(((lx-cx-.15)/.39)**2)-((ly-(top+ry*.42))/.36)**2);
      const noise=((x*13+y*7)%5-2)*.32;
      for(let c=0;c<3;c++)output[k+c]=clamp(foreheadColumns[x][c]+shade+shine+noise,0,255);
      output[k+3]=Math.round(Math.max(inScalp,isHair?1:0)*255);
    }
  }
  return true;
}
export class BaldRenderer {
  constructor(){this.worker=null;this.status='idle';this.error='';this.busy=false;this.masks=new Map();this.layers=new Map();this.lastRequest=0;this.sequence=0;this.disposed=false;}
  start(){
    if(this.disposed||this.status!=='idle')return;
    this.status='loading';
    try{
      this.worker=new Worker(new URL('./hairSegmentation.worker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{
        if(this.disposed)return;
        if(data.type==='ready')this.status='ready';
        if(data.type==='mask'){
          this.busy=false;
          this.masks.set(data.faceId,{pixels:normalizeHairMask(data.pixels,data.width,data.height),time:performance.now(),sequence:data.sequence});
        }
        if(data.type==='error')this.fail(data.message);
      };
      this.worker.onerror=event=>this.fail(event.message||'Worker failed');
      const base=new URL(import.meta.env.BASE_URL,location.href);
      this.worker.postMessage({type:'init',wasmPath:new URL('mediapipe/wasm',base).href,modelPath:new URL('mediapipe/models/selfie_multiclass_256x256.tflite',base).href});
    }catch(error){this.fail(error.message);}
  }
  fail(message){if(this.disposed)return;this.status='error';this.error=message;this.busy=false;this.worker?.terminate();this.worker=null;}
  hasMask(id){const m=this.masks.get(id);return !!m&&performance.now()-m.time<1800;}
  notice(){return this.status==='error'?'Hiệu ứng hói đầu chưa sẵn sàng. Bấm lại Hói đầu để thử lại.':this.status!=='ready'||!this.masks.size?'Đang tải và nhận diện vùng tóc…':'';}
  render(ctx,size,faces,{snapshot=false}={}){
    if(!faces.length)return;
    this.start();
    const ids=new Set(faces.map(f=>f.id));
    for(const id of this.layers.keys())if(!ids.has(id)){this.layers.delete(id);this.masks.delete(id);}
    const ordered=[...faces].sort((a,b)=>(this.masks.get(a.id)?.time??0)-(this.masks.get(b.id)?.time??0));
    for(const face of ordered){
      let layer=this.layers.get(face.id);
      if(!layer){const crop=document.createElement('canvas'),overlay=document.createElement('canvas');overlay.width=SIDE;overlay.height=SIDE;layer={crop,overlay,data:overlay.getContext('2d').createImageData(SIDE,SIDE)};this.layers.set(face.id,layer);}
      const now=performance.now(),cached=this.masks.get(face.id);
      const needsPaint=!!cached && (snapshot||cached.sequence!==layer.lastSequence||now-(layer.lastPaint??0)>110);
      const needsRequest=!snapshot&&!face.stale&&this.status==='ready'&&!this.busy&&now-this.lastRequest>160&&typeof createImageBitmap==='function';
      const f=needsPaint||needsRequest?cropHead(ctx,size,face,layer.crop):faceFrame(face,size);
      if(!f)continue;
      if(needsRequest){
        this.busy=true;this.lastRequest=now;
        createImageBitmap(layer.crop).then(bitmap=>{if(this.disposed||!this.worker){bitmap.close();return;}this.worker.postMessage({type:'frame',bitmap,faceId:face.id,timestamp:now,sequence:++this.sequence},[bitmap]);}).catch(error=>this.fail(error.message));
      }
      if(!cached||now-cached.time>1800)continue;
      if(needsPaint){
        const pixels=layer.crop.getContext('2d').getImageData(0,0,SIDE,SIDE).data;
        layer.visible=paintScalp(pixels,cached.pixels,f,layer.data.data);
        layer.lastPaint=now;layer.lastSequence=cached.sequence;
        if(layer.visible)layer.overlay.getContext('2d').putImageData(layer.data,0,0);
      }
      if(!layer.visible)continue;
      ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.angle);ctx.scale(f.d,f.d);ctx.drawImage(layer.overlay,LEFT,TOP,SPAN,SPAN);ctx.restore();
    }
  }
  dispose(){this.disposed=true;this.worker?.terminate();this.worker=null;this.masks.clear();this.layers.clear();}
}
