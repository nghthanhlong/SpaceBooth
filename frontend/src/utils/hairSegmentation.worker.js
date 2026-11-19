import { HairImageSegmenter, HairFilesetResolver } from 'spacebooth-cv';

let segmenter;
let starting;
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    starting = (async () => {
      const vision = await HairFilesetResolver.forVisionTasks(data.wasmPath, true);
      segmenter = await HairImageSegmenter.createFromOptions(vision, {
        baseOptions: {modelAssetPath:data.modelPath, delegate:'CPU'},
        canvas:new OffscreenCanvas(1,1),
        runningMode:'VIDEO', outputCategoryMask:true, outputConfidenceMasks:false,
      });
      self.postMessage({type:'ready'});
    })().catch(error => self.postMessage({type:'error',message:error.message}));
    return;
  }
  if (data.type !== 'frame') return;
  try {
    await starting;
    if (!segmenter) throw new Error('Hair model unavailable');
    segmenter.segmentForVideo(data.bitmap, data.timestamp, result => {
      const mask=result.categoryMask;
      if (!mask) throw new Error('Hair model returned no mask');
      const pixels=new Uint8Array(mask.getAsUint8Array());
      self.postMessage({type:'mask',faceId:data.faceId,width:mask.width,height:mask.height,pixels,sequence:data.sequence},[pixels.buffer]);
    });
  } catch(error) {self.postMessage({type:'error',message:error.message});}
  finally {data.bitmap.close();}
};
