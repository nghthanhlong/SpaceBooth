import{describe,it,expect,vi,beforeEach,afterEach}from'vitest';
vi.mock('react',()=>({useCallback:f=>f,useEffect:f=>f(),useRef:value=>({current:value}),useState:value=>[value,()=>{}]}));
const state=vi.hoisted(()=>({instances:[]}));
vi.mock('../utils/baldRenderer',()=>({BaldRenderer:class{
 constructor(){this.status='loading';state.instances.push(this);}
 render(){this.status='error';}
 notice(){return'initialization failed';}
 dispose=vi.fn();
 hasMask(){return false;}
}}));
import useStickers from './useStickers';
const face={id:1,stale:false,landmarks:Array.from({length:478},(_,i)=>({x:i===33?.4:i===263?.6:.5,y:i===10?.3:.5,z:0}))};
beforeEach(()=>{state.instances.length=0;vi.stubGlobal('Image',class{naturalWidth=240;naturalHeight=150;set src(_value){this.onload();}});});
afterEach(()=>vi.unstubAllGlobals());
describe('bald initialization recovery',()=>{
 it('keeps the effect on its owner when another face appears at the same position',()=>{
  const hook = useStickers();
  const size = {width:1000, height:1000};
  const neighbor = {...face, id:2};
  hook.autoSnapSticker('bald', [face], face.id);
  hook.renderFaceEffects({}, size, [face]);
  const render = vi.spyOn(state.instances[0], 'render');
  hook.renderFaceEffects({}, size, [neighbor]);
  expect(render).not.toHaveBeenCalled();
  hook.renderFaceEffects({}, size, [face, neighbor]);
  expect(render.mock.calls[0][2].map(target => target.id)).toEqual([face.id]);
 });
 it('retries initialization when the selected filter is clicked again',()=>{
  const hook=useStickers();hook.autoSnapSticker('bald',[face]);hook.renderFaceEffects({}, {width:1000,height:1000},[face]);
  expect(hook.getEffectNotice()).toBe('initialization failed');
  expect(hook.autoSnapSticker('bald',[face]).action).toBe('unchanged');
  expect(state.instances[0].dispose).toHaveBeenCalledOnce();
  hook.renderFaceEffects({}, {width:1000,height:1000},[face]);expect(state.instances).toHaveLength(2);
 });
 it('disposes the worker when bald is removed or replaced by hair',()=>{
  const hook=useStickers();hook.autoSnapSticker('bald',[face]);hook.renderFaceEffects({}, {width:1000,height:1000},[face]);
  hook.autoSnapSticker('gojo',[face]);expect(state.instances[0].dispose).toHaveBeenCalledOnce();
  hook.autoSnapSticker('bald',[face]);hook.renderFaceEffects({}, {width:1000,height:1000},[face]);
  hook.removeSticker('1:bald');expect(state.instances[1].dispose).toHaveBeenCalledOnce();
 });
});
