import {describe,it,expect} from 'vitest';
import {adjustmentFromPercent,adjustmentToPercent} from './PhotoStickerEditor';

describe('0–100 sticker adjustment controls',()=>{
  it.each(['scale','angle','dx','dy'])('%s defaults to 50 when left blank',kind=>{
    const initial=kind==='scale'?1:0;
    expect(adjustmentFromPercent(kind,'')).toBe(initial);
    expect(adjustmentToPercent(kind,initial)).toBe(50);
    for(const n of [0,1,25,49,50,51,75,99,100]) {
      expect(adjustmentToPercent(kind,adjustmentFromPercent(kind,n))).toBe(n);
    }
  });
  it('preserves the original adjustment limits and centers',()=>{
    expect(adjustmentFromPercent('scale',0)).toBeCloseTo(.3);
    expect(adjustmentFromPercent('scale',100)).toBe(2);
    expect(adjustmentFromPercent('angle',0)).toBe(-90);
    expect(adjustmentFromPercent('angle',100)).toBe(90);
    expect(adjustmentFromPercent('dx',0)).toBe(-.8);
    expect(adjustmentFromPercent('dy',100)).toBe(.8);
  });
  it.each(['scale','angle','dx','dy'])('clamps %s typed values to the allowed interval',kind=>{
    expect(adjustmentFromPercent(kind,-10)).toBe(adjustmentFromPercent(kind,0));
    expect(adjustmentFromPercent(kind,500)).toBe(adjustmentFromPercent(kind,100));
    expect(adjustmentFromPercent(kind,'invalid')).toBe(adjustmentFromPercent(kind,50));
  });
});
