// build_kb.js
// Usage: node build_kb.js input_folder outputfile.json
const fs = require('fs');
const path = require('path');

function normalize(text){
  return String(text).normalize('NFKC').replace(/[“”‘’]/g,'"').replace(/[^\w\s\-\.,;:()]/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
}
function tokenize(text){ return normalize(text).split(/\s+/).filter(Boolean); }

function chunkTokens(tokens, chunkSize=200){
  const out = [];
  for(let i=0;i<tokens.length;i+=chunkSize){
    out.push(tokens.slice(i,i+chunkSize).join(' '));
  }
  return out;
}

function shinglesFromText(text, k=5){
  const t = normalize(text).replace(/\s+/g,' ');
  const s = [];
  for(let i=0;i + k <= t.length;i++){
    s.push(t.slice(i,i+k));
  }
  return Array.from(new Set(s));
}

// jshash32 same as client
function jshash32(str, seed=0){
  let h = seed >>> 0;
  for(let i=0;i<str.length;i++){
    h += str.charCodeAt(i);
    h += (h << 10);
    h ^= (h >>> 6);
  }
  h += (h << 3);
  h ^= (h >>> 11);
  h += (h << 15);
  return h >>> 0;
}
function minhashSignatureFromShingles(shingles, k=128, seedBase=0x9e3779b9){
  const sig = new Uint32Array(k);
  for(let i=0;i<k;i++) sig[i] = 0xffffffff;
  for(const s of shingles){
    for(let i=0;i<k;i++){
      const h = jshash32(s, seedBase ^ i);
      if(h < sig[i]) sig[i] = h;
    }
  }
  return Array.from(sig);
}

async function main(){
  const inDir = process.argv[2] || './input';
  const outFile = process.argv[3] || './output/chunks.json';
  if(!fs.existsSync(inDir)) { console.error('input folder missing'); process.exit(1); }
  const files = fs.readdirSync(inDir).filter(f => f.endsWith('.txt'));
  const chunks = [];
  for(const f of files){
    const title = path.basename(f, '.txt');
    const text = fs.readFileSync(path.join(inDir,f),'utf8');
    const toks = tokenize(text);
    const cts = chunkTokens(toks, 200);
    for(let i=0;i<cts.length;i++){
      const txt = cts[i];
      const id = `${title.replace(/\s+/g,'_')}_${i}`;
      const shingles = shinglesFromText(txt, 5);
      const signature = minhashSignatureFromShingles(shingles, 128);
      chunks.push({ id, title, text: txt, shingles, signature });
    }
    console.log(`Processed ${f} -> ${cts.length} chunks`);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive:true });
  fs.writeFileSync(outFile, JSON.stringify(chunks, null, 2));
  console.log(`Wrote ${chunks.length} chunks to ${outFile}`);
}

main().catch(err => console.error(err));
