import {describe,it,expect,vi,afterEach} from 'vitest';
import {personMask,VirtualBackground} from './virtualBackground';
afterEach(()=>vi.unstubAllGlobals());
describe('webcam virtual backgrounds',()=>{
  it('removes background while retaining hair, skin, clothing and accessories',()=>{
    const rgba=personMask(new Uint8Array([0,1,2,3,4,5,255]));
    expect(Array.from(rgba).filter((_,i)=>i%4===3)).toEqual([0,255,255,255,255,255,0]);
  });
  it('waits for an exact snapshot mask and keeps one frame in flight',async()=>{
    const sent=[];
    class Worker {
      postMessage=vi.fn(data=>sent.push(data)); terminate=vi.fn();
    }
    const context={drawImage:vi.fn(),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:vi.fn()};
    vi.stubGlobal('Worker',Worker);
    vi.stubGlobal('location',{href:'https://spacebooth.test/'});
    vi.stubGlobal('document',{createElement:()=>({width:1,height:1,getContext:()=>context})});
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({close:vi.fn()})));
    const renderer=new VirtualBackground();renderer.select('dark');
    const worker=renderer.worker;worker.onmessage({data:{type:'ready'}});
    const ctx={canvas:{}},size={width:640,height:360};
    const first=renderer.request(ctx,size);
    expect(renderer.request(ctx,size)).toBeNull();
    await Promise.resolve();
    renderer.composite=vi.fn();
    const snapshot=renderer.snapshot(ctx,size);
    const frame1=sent.find(item=>item.type==='frame');
    worker.onmessage({data:{type:'mask',sequence:frame1.sequence,width:1,height:1,pixels:new Uint8Array([1])}});
    const savedMask=renderer.mask;
    await first;await Promise.resolve();await Promise.resolve();
    const frames=sent.filter(item=>item.type==='frame');expect(frames).toHaveLength(2);
    expect(renderer.composite).not.toHaveBeenCalled();
    worker.onmessage({data:{type:'mask',sequence:frames[1].sequence,width:1,height:1,pixels:new Uint8Array([0])}});
    await snapshot;expect(renderer.composite).toHaveBeenCalledOnce();
    expect(renderer.mask).toBe(savedMask);
    renderer.dispose();expect(worker.terminate).toHaveBeenCalledOnce();
    worker.onmessage({data:{type:'ready'}});expect(renderer.status).toBe('idle');
  });
  it('does not silently export the real room when the model is unavailable',async()=>{
    const renderer=new VirtualBackground();renderer.scene='snow';renderer.status='loading';
    await expect(renderer.snapshot({},{})).rejects.toThrow();
    renderer.dispose();expect(renderer.notice()).toBe('');
  });
});
