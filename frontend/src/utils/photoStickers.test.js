import {describe,it,expect,vi,afterEach} from 'vitest';
import {insertPhotoSticker,adjustedFace,renderPhotoStickers,releasePhotoRendering} from './photoStickers';

afterEach(()=>vi.unstubAllGlobals());

describe('post-capture sticker edits',()=>{
  it('cancels obsolete work, decodes once and releases the photo cache',async()=>{
    let finishDecode;
    const decode=vi.fn(()=>new Promise(resolve=>{finishDecode=resolve;}));
    vi.stubGlobal('Image',class {naturalWidth=100;naturalHeight=100;decode=decode;});
    vi.stubGlobal('document',{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/png;base64,test'})});
    const photo={id:'p',previewUrl:'blob:photo',faces:[]};
    const first=renderPhotoStickers(photo,[]);
    const aborted=expect(first).rejects.toMatchObject({name:'AbortError'});
    const edits=[];
    const second=renderPhotoStickers(photo,edits);
    expect(renderPhotoStickers(photo,edits)).toBe(second);
    expect(decode).toHaveBeenCalledTimes(1);
    finishDecode();
    await aborted;
    expect(await second).toBe('data:image/png;base64,test');
    releasePhotoRendering([photo]);
    const third=renderPhotoStickers(photo,[]);
    expect(decode).toHaveBeenCalledTimes(2);
    finishDecode();await third;
  });
  it('replaces overlapping slots only on the chosen face',()=>{
    const items=[{id:'a',kind:'gojo',faceId:1},{id:'b',kind:'frieren',faceId:1},{id:'c',kind:'gojo',faceId:2}];
    const next=insertPhotoSticker(items,{id:'d',kind:'glasses',faceId:1});
    expect(next.map(e=>e.id)).toEqual(['b','c','d']);
    expect(items).toHaveLength(3);
  });
  it('keeps the saved face unchanged at the default transform',()=>{
    const landmarks=Array.from({length:478},()=>({x:.5,y:.6,z:0}));
    landmarks[33]={x:.4,y:.4};landmarks[263]={x:.6,y:.4};
    const face={id:1,landmarks};
    const transformed=adjustedFace(face,{scale:1,angle:0,dx:0,dy:0},{width:1000,height:500});
    expect(transformed).toEqual(face);expect(transformed.landmarks).not.toBe(landmarks);
  });
  it('rotates in pixel coordinates on a wide photo and preserves the source',()=>{
    const landmarks=Array.from({length:478},()=>({x:.6,y:.4,z:0}));
    landmarks[33]={x:.4,y:.4};landmarks[263]={x:.6,y:.4};
    const face={id:1,landmarks};
    const transformed=adjustedFace(face,{scale:1,angle:90,dx:.1,dy:.05},{width:1000,height:500});
    expect(transformed.landmarks[1].x).toBeCloseTo(.6);
    expect(transformed.landmarks[1].y).toBeCloseTo(.65);
    expect(landmarks[1]).toEqual({x:.6,y:.4,z:0});
  });
});
