// Raster sprites are decoded once by useStickers; simple accessories stay vector.
const svg = (body, w = 240, h = 160) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`)}`;
const ASSET_REVISIONS = {gojo:3,ayanokoji:3,'goku-purple':4,'goku-gold':4};
const raster = (id, name, slot, type = 'hair') => ({id, name, slot, type, src: `${import.meta.env.BASE_URL}stickers/face/${id}.png${ASSET_REVISIONS[id]?'?rev='+ASSET_REVISIONS[id]:''}`});
const hornShapes = [
  'M90 145C29 135 2 84 36 5C19 67 69 68 94 113Z',
  'M88 145C33 138 15 100 26 70L13 77L37 40L29 48L46 5C35 64 86 67 98 114Z',
  'M89 146C28 124 22 81 56 45Q89 12 64 2C115 29 70 66 85 92Q103 115 89 146Z',
  'M88 145C25 127 8 83 8 12C25 60 58 80 93 108Z',
  'M89 145L55 132L32 109L37 86L19 92L39 63L31 63L58 9L66 55L58 80L80 74L73 98L96 115Z',
  'M92 140Q56 86 4 107Q33 88 8 39Q48 68 66 62Q94 82 96 111Z',
];
export const FACE_EFFECTS = [
  raster('gojo', 'Gojo · tóc và bịt mắt', 'head'),
  raster('goku-purple', 'Goku tím', 'head'),
  raster('goku-blue', 'Goku xanh', 'head'),
  raster('goku-gold', 'Goku vàng', 'head'),
  raster('ayanokoji', 'Tóc Ayanokoji', 'head'),
  raster('frieren', 'Tai Frieren', 'ears', 'elf'),
  {id:'vampire', name:'Răng nanh', slot:'mouth', type:'fangs', src:svg('<path d="M65 30Q78 32 90 30L82 107Q70 91 65 30ZM150 30Q162 32 175 30Q170 91 158 107Z" fill="#fffdf5" stroke="#b9aab2" stroke-width="3"/>')},
  raster('cat-ears', 'Tai, mũi và râu mèo', 'head', 'cat'),
  ...Array.from({length:6}, (_,i)=>({id:`horns-${i+1}`,name:`Sừng quỷ ${i+1}`,slot:'horns',type:'horns',variant:i,src:svg(`<g fill="${['#1a1427','#59202c','#251530','#ac213c','#222c43','#6c253a'][i]}" stroke="#e5a5bd" stroke-width="2"><path d="${hornShapes[i]}"/><path d="${hornShapes[i]}" transform="translate(240 0) scale(-1 1)"/></g>`)})),
  raster('beard-detailed','Râu ria xoăn','beard','beard'),
  raster('beard-bold','Râu quai nón','beard','beard'),
  ...[['bald','Hói đầu','head'],['sigma','Sigma / Gigachad','deform'],['sharp-chin','Cằm nhọn','deform'],['big-face','Mặt phình to','deform'],['small-face','Mặt thu nhỏ','deform']].map(([id,name,slot])=>({id,name,slot,type:id==='bald'?'bald':'warp',src:svg(`<ellipse cx="120" cy="76" rx="${id==='big-face'?84: id==='small-face'?45:65}" ry="65" fill="#f3c6a2" stroke="#a984e9" stroke-width="5"/><path d="M88 63h10m44 0h10M101 103q19 12 38 0" fill="none" stroke="#55405f" stroke-width="7" stroke-linecap="round"/>${id==='sharp-chin'?'<path d="M67 100L120 157L173 100" fill="#f3c6a2" stroke="#a984e9" stroke-width="5"/>':''}`)})),
];
export const EFFECT_BY_ID = Object.fromEntries(FACE_EFFECTS.map(e=>[e.id,e]));
