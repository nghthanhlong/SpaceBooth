import {describe,it,expect,vi,afterEach} from 'vitest';
import {faceFrame,placeSticker,drawFaceSticker,slotsOverlap} from './faceStickerGeometry';
import {normalizeHairMask,paintScalp,BaldRenderer} from './baldRenderer';
it('keeps face sprite history bounded across long sessions',()=>{
  const {ctx}=context();
  const img={naturalWidth:240,naturalHeight:200,faceBounds:{x:0,y:0,w:240,h:200}};
  for(let id=0;id<1000;id++){
    const f={...face(),id};
    drawFaceSticker(ctx,'gojo',img,placeSticker(f,'gojo',size),size,f);
  }
  expect(img.faceLayouts.size).toBe(32);
  expect(img.faceLayouts.has(0)).toBe(false);
  expect(img.faceLayouts.has(999)).toBe(true);
});
const size={width:1000,height:1000};
function face(){
  const landmarks=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
  const set=(i,x,y)=>{landmarks[i]={x,y,z:0};};
  set(33,.4,.4);set(263,.6,.4);set(10,.5,.28);set(152,.5,.66);
  set(234,.34,.49);set(454,.66,.49);set(127,.34,.4);set(356,.66,.4);
  set(13,.5,.55);set(14,.5,.565);set(0,.5,.535);set(17,.5,.58);set(61,.45,.555);set(291,.55,.555);set(1,.5,.49);
  return{id:1,landmarks,stale:false};
}
function context(){const calls=[];const ctx={};
 for(const method of ['save','restore','translate','rotate','scale','drawImage','beginPath','moveTo','lineTo','quadraticCurveTo','bezierCurveTo','closePath','fill','stroke','rect','clip'])ctx[method]=(...args)=>calls.push({method,args});
 ctx.createLinearGradient=()=>({addColorStop(){}});return{ctx,calls};
}
const image=()=>({naturalWidth:240,naturalHeight:160});
afterEach(()=>vi.unstubAllGlobals());
describe('face accessories',()=>{
 it('reserves both eyes and head for the Gojo bundle',()=>{
  expect(slotsOverlap('gojo','glasses')).toBe(true);expect(slotsOverlap('gojo','hat')).toBe(true);
  expect(slotsOverlap('gojo','horns-1')).toBe(false);expect(slotsOverlap('gojo','frieren')).toBe(false);
 });
 it.each([1,2,3,4,5,6])('places horn pair %s as two independently separated sprites',n=>{
  const{ctx,calls}=context(),f=face();drawFaceSticker(ctx,`horns-${n}`,image(),placeSticker(f,`horns-${n}`,size),size,f);
  const draws=calls.filter(c=>c.method==='drawImage');expect(draws).toHaveLength(2);
  const [a,b]=draws.map(d=>d.args);const centers=a[5]+a[7]/2,bcenter=b[5]+b[7]/2;
  expect(bcenter-centers).toBeGreaterThanOrEqual(1.18);
 });
 it('raises cat ears onto hair while preserving the nose anchor',()=>{
  const{ctx,calls}=context(),f=face(),frame=faceFrame(f,size);
  drawFaceSticker(ctx,'cat-ears',image(),placeSticker(f,'cat-ears',size),size,f);
  const draws=calls.filter(c=>c.method==='drawImage');expect(draws).toHaveLength(2);
  for(const d of draws)expect(d.args[6]+d.args[8]).toBeCloseTo(frame.local(10).y-.24);
  const nose=frame.local(1);expect(calls.some(c=>c.method==='lineTo'&&Math.abs(c.args[0]-nose.x)<1e-8&&Math.abs(c.args[1]-(nose.y+.055))<1e-8)).toBe(true);
 });
 it.each(['gojo','ayanokoji','goku-purple','goku-blue','goku-gold'])('draws only the %s PNG without a rear color shape',kind=>{
  const{ctx,calls}=context(),f=face();drawFaceSticker(ctx,kind,image(),placeSticker(f,kind,size),size,f);
  expect(calls.filter(c=>c.method==='drawImage')).toHaveLength(1);
  expect(calls.some(c=>['fill','stroke','beginPath','bezierCurveTo'].includes(c.method))).toBe(false);
 });
 it('anchors the joined Gojo cloth to the eye line rather than the forehead',()=>{
  const{ctx,calls}=context(),f=face();
  const img={naturalWidth:240,naturalHeight:200,faceBounds:{x:0,y:0,w:240,h:200},faceBandBounds:{x:40,y:140,w:160,h:60}};
  drawFaceSticker(ctx,'gojo',img,placeSticker(f,'gojo',size),size,f);
  const d=calls.find(c=>c.method==='drawImage').args;
  expect(d[5]+d[7]*(40+80)/240).toBeCloseTo(0);
  expect(d[6]+d[8]*(140+30)/200).toBeCloseTo(-.12);
  expect(d[7]*160/240).toBeGreaterThanOrEqual(1.56);
 });
 it('increases elf ears while keeping their roots at the temples',()=>{
  const{ctx,calls}=context(),f=face();drawFaceSticker(ctx,'frieren',image(),placeSticker(f,'frieren',size),size,f);
  const draws=calls.filter(c=>c.method==='drawImage');expect(draws).toHaveLength(2);
  expect(draws[0].args[7]).toBeCloseTo(.64);expect(draws[1].args[7]).toBeCloseTo(.64);
 });
 it('overlaps the natural ear while clipping the innermost bulb',()=>{
  const{ctx,calls}=context(),f=face(),frame=faceFrame(f,size);
  drawFaceSticker(ctx,'frieren',image(),placeSticker(f,'frieren',size),size,f);
  const rects=calls.filter(c=>c.method==='rect'&&Math.abs(c.args[3]-4)<1e-8).map(c=>c.args);
  const sides=[frame.local(127),frame.local(356)].sort((a,b)=>a.x-b.x);
  expect(rects[0][0]+rects[0][2]).toBeCloseTo(sides[0].x+.13);
  expect(rects[1][0]).toBeCloseTo(sides[1].x-.13);
 });
 it('cuts only the small inward lobe tip while keeping the upper ear coverage',()=>{
  const{ctx,calls}=context(),f=face(),frame=faceFrame(f,size);
  drawFaceSticker(ctx,'frieren',image(),placeSticker(f,'frieren',size),size,f);
  const tips=calls.filter(c=>c.method==='rect'&&Math.abs(c.args[3]-.22)<1e-8).map(c=>c.args);
  const sides=[frame.local(127),frame.local(356)].sort((a,b)=>a.x-b.x);
  expect(tips).toHaveLength(2);expect(tips[0][0]).toBeCloseTo(sides[0].x+.035);
  expect(tips[1][0]+tips[1][2]).toBeCloseTo(sides[1].x-.035);
  for(let i=0;i<2;i++)expect(tips[i][1]).toBeCloseTo(sides[i].y+.10);
 });
 it('places each elf root over the ear rather than separated from the head',()=>{
  const{ctx,calls}=context(),f=face(),frame=faceFrame(f,size);
  drawFaceSticker(ctx,'frieren',image(),placeSticker(f,'frieren',size),size,f);
  const draws=calls.filter(c=>c.method==='drawImage').map(c=>c.args);
  const sides=[frame.local(127),frame.local(356)].sort((a,b)=>a.x-b.x);
  expect(draws[0][5]+draws[0][7]).toBeCloseTo(sides[0].x+.16);
  expect(draws[1][5]).toBeCloseTo(sides[1].x-.16);
  for(let i=0;i<2;i++)expect(draws[i][6]+draws[i][8]*.75).toBeCloseTo(sides[i].y+.20);
 });
 it('raises Ayanokoji slightly without changing the approved width',()=>{
  const{ctx,calls}=context(),f=face(),frame=faceFrame(f,size),img=image();
  drawFaceSticker(ctx,'ayanokoji',img,placeSticker(f,'ayanokoji',size),size,f);
  const d=calls.find(c=>c.method==='drawImage').args;
  expect(d[7]).toBeCloseTo(Math.max(2.67,Math.abs(frame.local(454).x-frame.local(234).x)*1.67));
  expect(d[6]+d[8]*.5).toBeCloseTo(frame.local(10).y-.12);
 });
 it('uses a mouth-shaped cutout and bounds the short beard below the eyes',()=>{
  const{ctx,calls}=context(),f=face(),frame=faceFrame(f,size);
  drawFaceSticker(ctx,'beard-bold',image(),placeSticker(f,'beard-bold',size),size,f);
  expect(calls.some(c=>c.method==='clip'&&c.args[0]==='evenodd')).toBe(true);
  const d=calls.find(c=>c.method==='drawImage').args;
  expect(d[6]).toBeGreaterThan(.15);expect(d[6]+d[8]).toBeCloseTo(frame.local(152).y+.13);
 });
});
describe('bald hair removal v2',()=>{
 it('selects only the hair category and expands thin edge pixels',()=>{
  const pixels=new Uint8Array(256*256);pixels[100*256+100]=1;pixels[100*256+130]=3;pixels[100*256+150]=5;
  const mask=normalizeHairMask(pixels,256,256);
  expect(mask[100*256+100]).toBe(255);expect(mask[99*256+99]).toBe(255);expect(mask[100*256+130]).toBe(0);expect(mask[100*256+150]).toBe(0);
 });
 it('replaces a hair mask without painting over the real nose or eyes',()=>{
  const f=face(),frame=faceFrame(f,size),source=new Uint8Array(256*256*4),mask=new Uint8Array(256*256),out=new Uint8Array(source.length);
  for(let n=0;n<mask.length;n++)source.set([170,125,105,255],n*4);
  for(let y=54;y<110;y++)for(let x=80;x<176;x++)mask[y*256+x]=255;
  expect(paintScalp(source,mask,frame,out)).toBe(true);
  const eyeY=Math.round((0+2)*256/3.6),noseY=Math.round((frame.local(1).y+2)*256/3.6);
  expect(out[(eyeY*256+128)*4+3]).toBe(0);expect(out[(noseY*256+128)*4+3]).toBe(0);
  expect(out[(80*256+128)*4+3]).toBe(255);
 });
 it('does not draw a brown cap before a valid hair mask exists',()=>{
  const source=new Uint8Array(256*256*4).fill(120),out=new Uint8Array(source.length);
  expect(paintScalp(source,new Uint8Array(256*256),faceFrame(face(),size),out)).toBe(false);
 });
 it('loads the bundled model only on demand and ignores messages after disposal',()=>{
  let worker;vi.stubGlobal('location',{href:'http://localhost:5173/'});
  vi.stubGlobal('Worker',class{constructor(){worker=this;}postMessage=vi.fn();terminate=vi.fn();});
  const renderer=new BaldRenderer();expect(worker).toBeUndefined();renderer.start();
  expect(renderer.status).toBe('loading');expect(worker.postMessage.mock.calls[0][0].modelPath).toMatch(/selfie_multiclass_256x256\.tflite$/);
  worker.onmessage({data:{type:'ready'}});expect(renderer.status).toBe('ready');
  worker.onmessage({data:{type:'mask',faceId:1,width:1,height:1,pixels:new Uint8Array([1]),sequence:1}});
  expect(renderer.hasMask(1)).toBe(true);renderer.dispose();expect(worker.terminate).toHaveBeenCalled();
  worker.onmessage({data:{type:'mask',faceId:1,width:1,height:1,pixels:new Uint8Array([1])}});expect(renderer.hasMask(1)).toBe(false);
 });
});
