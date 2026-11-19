import { faceFrame, pixel } from './faceStickerGeometry';
const MAX_CONTROLS=56;
export function displacement(point,controls) {
  let x=0,y=0;
  for(const k of controls){const r=Math.hypot(point.x-k.x,point.y-k.y)/k.r;
    if(r>=1)continue;const t=1-r*r,w=t*t*t;x+=k.dx*w;y+=k.dy*w;}
  return {x,y};
}
export function warpPoint(point,controls) {const d=displacement(point,controls);return{x:point.x+d.x,y:point.y+d.y};}
export function createControls(face,kind,size,strength=1) {
  const f=faceFrame(face,size);if(!f)return[];
  const out=[];
  const at=(index,dx,dy,r)=>{const p=pixel(face.landmarks[index],size);out.push({x:p.x,y:p.y,dx:(dx*f.c-dy*f.sn)*f.d*strength,dy:(dx*f.sn+dy*f.c)*f.d*strength,r:r*f.d});};
  const pair=(a,b,dx,dy,r)=>{const aa=f.local(a),bb=f.local(b);at(a,aa.x<bb.x?-dx:dx,dy,r);at(b,aa.x<bb.x?dx:-dx,dy,r);};
  if(kind==='sigma') {pair(172,397,.18,.02,.48);pair(176,400,.12,.06,.38);pair(123,352,.07,-.035,.4);at(152,0,.075,.4);}
  if(kind==='sharp-chin'){at(152,0,.48,1.2);pair(172,397,-.075,.025,.5);}
  if(kind==='big-face'||kind==='small-face'){const sign=kind==='big-face'?1:-1;pair(234,454,sign*.22,0,.92);at(152,0,sign*.16,.8);at(10,0,-sign*.1,.8);}
  return out;
}
const VS=`attribute vec2 aPos;varying vec2 vUv;void main(){vUv=(aPos+1.0)*0.5;gl_Position=vec4(aPos,0.0,1.0);}`;
const FS=`precision highp float;varying vec2 vUv;uniform sampler2D uImage;uniform vec2 uSize;uniform int uCount;uniform vec4 uControls[56];uniform float uRadii[56];
void main(){
  vec2 p=vec2(vUv.x,1.0-vUv.y)*uSize;vec2 q=p;
  for(int j=0;j<7;j++){
    vec2 d=vec2(0.0);mat2 jac=mat2(1.0);
    for(int i=0;i<56;i++){
      if(i>=uCount)break;
      vec2 v=q-uControls[i].xy;float r2=dot(v,v)/(uRadii[i]*uRadii[i]);
      float t=max(0.0,1.0-r2);vec2 delta=uControls[i].zw;
      d+=delta*t*t*t;vec2 grad=-6.0*t*t*v/(uRadii[i]*uRadii[i]);
      jac[0]+=delta*grad.x;jac[1]+=delta*grad.y;
    }
    float det=jac[0].x*jac[1].y-jac[1].x*jac[0].y;
    vec2 residual=q+d-p;
    vec2 step=abs(det)>.05?vec2(jac[1].y*residual.x-jac[1].x*residual.y,-jac[0].y*residual.x+jac[0].x*residual.y)/det:residual;
    q-=step*min(1.0,uSize.y*.1/max(length(step),.001));
  }
  vec2 uv=clamp(vec2(q.x/uSize.x,1.0-q.y/uSize.y),vec2(0.0),vec2(1.0));
  gl_FragColor=texture2D(uImage,uv);
}`;
function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(message);}return s;}
export class FaceWarpRenderer {
  constructor(){this.canvas=null;this.gl=null;this.source=null;this.failed=false;}
  init(){
    this.canvas=document.createElement('canvas');
    const gl=this.canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
    if(!gl)throw new Error('WebGL unavailable');this.gl=gl;
    const vs=shader(gl,gl.VERTEX_SHADER,VS),fs=shader(gl,gl.FRAGMENT_SHADER,FS),program=gl.createProgram();
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    this.program=program;gl.useProgram(program);
    const buffer=gl.createBuffer();this.buffer=buffer;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const a=gl.getAttribLocation(program,'aPos');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
    this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.loc=Object.fromEntries(['uImage','uSize','uCount','uControls[0]','uRadii[0]'].map(n=>[n,gl.getUniformLocation(program,n)]));
    gl.uniform1i(this.loc.uImage,0);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    this.values=new Float32Array(MAX_CONTROLS*4);this.radii=new Float32Array(MAX_CONTROLS);
  }
  render(ctx,size,controls){
    if(!controls.length)return;
    if(!this.gl&&!this.failed){try{this.init();}catch{this.failed=true;}}
    const gl=this.gl;
    if(gl&&!gl.isContextLost()){
      try{
        const{width:w,height:h}=size;
        if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
        gl.viewport(0,0,w,h);gl.useProgram(this.program);gl.bindTexture(gl.TEXTURE_2D,this.texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,ctx.canvas);
        this.values.fill(0);this.radii.fill(1);
        controls.slice(0,MAX_CONTROLS).forEach((k,i)=>{this.values.set([k.x,k.y,k.dx,k.dy],i*4);this.radii[i]=k.r;});
        gl.uniform2f(this.loc.uSize,w,h);gl.uniform1i(this.loc.uCount,Math.min(controls.length,MAX_CONTROLS));
        gl.uniform4fv(this.loc['uControls[0]'],this.values);gl.uniform1fv(this.loc['uRadii[0]'],this.radii);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);ctx.drawImage(this.canvas,0,0);return;
      }catch{this.failed=true;this.dispose();}
    }
    this.renderMesh(ctx,size,controls);
  }
  // Canvas fallback uses the same forward field, so accessories use matching landmarks.
  renderMesh(ctx,size,controls){
    this.source??=document.createElement('canvas');const src=this.source;
    if(src.width!==size.width||src.height!==size.height){src.width=size.width;src.height=size.height;}
    src.getContext('2d').drawImage(ctx.canvas,0,0);
    const step=Math.max(10,Math.min(size.width,size.height)/42);
    const x0=Math.max(0,Math.floor(Math.min(...controls.map(k=>k.x-k.r))/step)*step);
    const y0=Math.max(0,Math.floor(Math.min(...controls.map(k=>k.y-k.r))/step)*step);
    const x1=Math.min(size.width,Math.max(...controls.map(k=>k.x+k.r)));
    const y1=Math.min(size.height,Math.max(...controls.map(k=>k.y+k.r)));
    const triangle=(a,b,c)=>{
      const A=warpPoint(a,controls),B=warpPoint(b,controls),C=warpPoint(c,controls);
      const det=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);if(Math.abs(det)<.001)return;
      const m00=((B.x-A.x)*(c.y-a.y)-(C.x-A.x)*(b.y-a.y))/det;
      const m01=((C.x-A.x)*(b.x-a.x)-(B.x-A.x)*(c.x-a.x))/det;
      const m10=((B.y-A.y)*(c.y-a.y)-(C.y-A.y)*(b.y-a.y))/det;
      const m11=((C.y-A.y)*(b.x-a.x)-(B.y-A.y)*(c.x-a.x))/det;
      const center={x:(A.x+B.x+C.x)/3,y:(A.y+B.y+C.y)/3};
      const expand=p=>{const dx=p.x-center.x,dy=p.y-center.y,l=Math.hypot(dx,dy)||1;return{x:p.x+dx/l*.65,y:p.y+dy/l*.65};};
      const ea=expand(A),eb=expand(B),ec=expand(C);
      ctx.save();ctx.beginPath();ctx.moveTo(ea.x,ea.y);ctx.lineTo(eb.x,eb.y);ctx.lineTo(ec.x,ec.y);ctx.closePath();ctx.clip();
      ctx.transform(m00,m10,m01,m11,A.x-m00*a.x-m01*a.y,A.y-m10*a.x-m11*a.y);ctx.drawImage(src,0,0);ctx.restore();
    };
    for(let y=y0;y<y1;y+=step)for(let x=x0;x<x1;x+=step){const a={x,y},b={x:Math.min(x+step,x1),y},c={x,y:Math.min(y+step,y1)},d={x:b.x,y:c.y};triangle(a,b,c);triangle(b,d,c);}
  }
  dispose(){if(this.gl){this.gl.deleteTexture(this.texture);this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}this.gl=null;this.canvas=null;this.source=null;}
}
