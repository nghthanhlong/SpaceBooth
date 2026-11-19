const SCENES={dark:'#0f172a',white:'#ffffff',cyberpunk:'cyberpunk.png',sakura:'sakura.png',snow:'snow-village.png'};
export function personMask(categories) {
  const pixels=new Uint8ClampedArray(categories.length*4);
  for(let i=0;i<categories.length;i++) {
    pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=255;
    pixels[i*4+3]=categories[i]>0&&categories[i]<=5?255:0;
  }
  return pixels;
}
export class VirtualBackground {
  constructor(){this.scene='none';this.worker=null;this.status='idle';this.message='';this.mask=null;this.maskTime=0;this.sequence=0;this.pending=null;this.generation=0;this.lastRequest=0;this.image=null;}
  select(scene){
    if(scene==='none'){this.dispose();return;}
    if(!SCENES[scene])return;
    this.scene=scene;this.image=null;
    const generation=++this.generation;
    if(!SCENES[scene].startsWith('#')){
      const image=new Image();image.src=`${import.meta.env.BASE_URL}backgrounds/${SCENES[scene]}`;
      image.decode().then(()=>{if(this.generation===generation)this.image=image;}).catch(()=>{if(this.generation===generation){this.status='error';this.message='Không tải được ảnh nền. Chọn lại nền để thử lại.';}});
    }
    if(this.status==='error'){this.worker?.terminate();this.worker=null;this.status='idle';}
    if(!this.worker)this.start();
  }
  start(){
    this.status='loading';this.message='';
    try {
      this.worker=new Worker(new URL('./hairSegmentation.worker.js',import.meta.url),{type:'module'});
      const worker=this.worker;
      this.worker.onmessage=({data})=>{
        if(this.worker!==worker)return;
        if(data.type==='ready'&&this.status!=='error')this.status='ready';
        if(data.type==='error')this.fail(data.message);
        if(data.type==='mask'){
          if(!this.pending||data.sequence!==this.pending.sequence)return;
          const mask=document.createElement('canvas');mask.width=data.width;mask.height=data.height;
          const ctx=mask.getContext('2d'),pixels=ctx.createImageData(data.width,data.height);
          pixels.data.set(personMask(data.pixels));ctx.putImageData(pixels,0,0);
          this.mask=mask;this.maskTime=performance.now();
          const pending=this.pending;this.pending=null;clearTimeout(pending.timer);pending.resolve();
        }
      };
      this.worker.onerror=e=>{if(this.worker===worker)this.fail(e.message);};
      const base=new URL(import.meta.env.BASE_URL,location.href);
      this.worker.postMessage({type:'init',wasmPath:new URL('mediapipe/wasm',base).href,modelPath:new URL('mediapipe/models/selfie_multiclass_256x256.tflite',base).href});
    } catch(e){this.fail(e.message);}
  }
  fail(message){this.status='error';this.message=message||'Không tải được bộ tách người.';this.rejectPending();this.worker?.terminate();this.worker=null;}
  rejectPending(){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('Không thể tách người. Chọn lại nền rồi thử lại.'));this.pending=null;}}
  ready(){return this.scene!=='none'&&this.status==='ready'&&(SCENES[this.scene].startsWith('#')||!!this.image);}
  notice(){return this.scene==='none'?'':this.status==='error'?'Nền webcam chưa sẵn sàng. Chọn lại nền hoặc chọn Nền thật.':!this.ready()||!this.mask?'Đang tải và tách người khỏi nền…':'';}
  request(ctx,size){
    if(!this.ready()||this.pending)return null;
    this.input??=document.createElement('canvas');this.input.width=320;this.input.height=Math.max(1,Math.round(320*size.height/size.width));
    this.input.getContext('2d').drawImage(ctx.canvas,0,0,this.input.width,this.input.height);
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
    // Live requests intentionally have no caller; keep rejection handled on disposal.
    promise.catch(()=>{});
    const pending={sequence:++this.sequence,promise,resolve,reject};this.pending=pending;
    pending.timer=setTimeout(()=>{if(this.pending===pending)this.fail('Segmentation timed out');},12000);
    createImageBitmap(this.input).then(bitmap=>{
      if(this.pending!==pending||!this.worker){bitmap.close();return;}
      this.worker.postMessage({type:'frame',bitmap,faceId:0,timestamp:performance.now(),sequence:pending.sequence},[bitmap]);
    }).catch(e=>{if(this.pending===pending)this.fail(e.message);});
    this.lastRequest=performance.now();return promise;
  }
  composite(ctx,size){
    if(!this.ready()||!this.mask)return;
    this.foreground??=document.createElement('canvas');const fg=this.foreground;
    if(fg.width!==size.width||fg.height!==size.height){fg.width=size.width;fg.height=size.height;}
    const c=fg.getContext('2d');c.clearRect(0,0,fg.width,fg.height);c.drawImage(ctx.canvas,0,0);
    c.save();c.globalCompositeOperation='destination-in';c.filter='blur(1.5px)';c.drawImage(this.mask,0,0,fg.width,fg.height);c.restore();
    if(this.image){
      const scale=Math.max(size.width/this.image.naturalWidth,size.height/this.image.naturalHeight);
      const w=this.image.naturalWidth*scale,h=this.image.naturalHeight*scale;
      ctx.drawImage(this.image,(size.width-w)/2,(size.height-h)/2,w,h);
    } else {ctx.fillStyle=SCENES[this.scene];ctx.fillRect(0,0,size.width,size.height);}
    ctx.drawImage(fg,0,0);
  }
  render(ctx,size){
    if(this.scene==='none')return;
    if(this.ready()&&!this.pending&&performance.now()-this.lastRequest>=120)this.request(ctx,size);
    if(performance.now()-this.maskTime<800)this.composite(ctx,size);
  }
  async snapshot(ctx,size){
    if(this.scene==='none')return;
    if(!this.ready())throw new Error(this.notice());
    if(this.pending)await this.pending.promise;
    await this.request(ctx,size);
    if(!this.ready())throw new Error('Nền webcam đã thay đổi. Hãy chụp lại.');
    this.composite(ctx,size);
  }
  dispose(){this.generation++;this.rejectPending();this.worker?.terminate();this.worker=null;this.scene='none';this.status='idle';this.mask=null;this.image=null;this.input=null;this.foreground=null;}
}
