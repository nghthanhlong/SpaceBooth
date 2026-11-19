import {describe,it,expect,vi} from 'vitest';
import {BACKGROUNDS,readBackground,saveBackground,validBackground} from './BackgroundPicker';

describe('background preference',()=>{
  it('restores every supported choice',()=>{
    for(const {id} of BACKGROUNDS) {
      const storage={getItem:()=>id,setItem:vi.fn()};
      expect(readBackground(storage)).toBe(id);
      saveBackground(id,storage);
      expect(storage.setItem).toHaveBeenCalledWith('spacebooth.background',id);
    }
  });
  it('uses the original dark background for absent or obsolete settings',()=>{
    for(const value of [null,'','old-theme','<script>']) {
      expect(readBackground({getItem:()=>value})).toBe('dark');
      expect(validBackground(value)).toBe('dark');
    }
  });
  it('continues working when browser storage is blocked',()=>{
    const storage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
    expect(readBackground(storage)).toBe('dark');
    expect(()=>saveBackground('snow',storage)).not.toThrow();
  });
});
