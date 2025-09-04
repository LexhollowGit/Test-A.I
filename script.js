/* ===========================================================
   ARU — Advanced Client Brain (script.js)
   - TF-IDF retriever + inverted index
   - MinHash + LSH paraphrase matching (uses signatures produced by preprocessor)
   - Math parser & executor (basic)
   - Slang expansion, memory with precise timestamps, IndexedDB persistence
   - Import/Export hooks for KB (chunks.json with signatures), slang, memory
   =========================================================== */

/* ----------------- DOM ----------------- */
const $ = s => document.querySelector(s);
const messagesEl = $('#messages');
const typingEl = $('#typing');
const inputEl = $('#user-input');
const formEl = $('#composer');
const personaEl = $('#personality');

const btnExportMem = $('#btn-export-mem');
const btnImportMem = $('#btn-import-mem');
const fileImportMem = $('#file-import-mem');
const btnExportKnow = $('#btn-export-know');
const btnImportKnow = $('#btn-import-know');
const fileImportKnow = $('#file-import-know');
const btnReset = $('#btn-reset');
const btnAbout = $('#btn-about');

/* ----------------- Utilities ----------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowClock = () => new Date().toLocaleTimeString();
const rand = arr => arr[Math.floor(Math.random()*arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function preciseNow(){
  const perf = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const base = (typeof performance !== 'undefined' && performance.timeOrigin) ? performance.timeOrigin : Date.now();
  return base + perf; // epoch + fractional ms
}

/* ----------------- Text utilities ----------------- */
function normalize(text){
  if(!text) return '';
  return String(text)
    .normalize('NFKC')
    .replace(/[“”‘’]/g,'"')
    .replace(/[_•†◆★✦●■◆]/g,' ')
    .replace(/[^\p{L}\p{N}\s'\-+*/().]/gu,' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
}
function tokenize(text){
  return normalize(text).split(/\s+/).filter(Boolean);
}
function titleCase(s){ return String(s).replace(/\b\w/g,c=>c.toUpperCase()); }
function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ----------------- Tiny Stemmer ----------------- */
function stem(w){ return w.replace(/(ing|ed|ly|ness|ment|ers|er|s)$/,'').replace(/ies$/,'y'); }

/* ----------------- Slang & synonyms (starter) ----------------- */
const SLANG = {
  u:"you", ur:"your", r:"are", y:"why", wtf:"what the fuck", brb:"be right back",
  idk:"i don't know", imo:"in my opinion", afaik:"as far as i know", gonna:"going to",
  wanna:"want to", gotta:"got to", tho:"though", cuz:"because", thx:"thanks",
  pls:"please", plz:"please", omw:"on my way", lmk:"let me know", bruh:"bro"
};
// extendable by importing a slang pack

const SYN = {
  hello:["hi","hey","yo","hiya","sup"],
  bye:["bye","goodbye","see ya","later"],
  thanks:["thanks","thank you","thx"]
};

function expandSlang(text){
  if(!text) return text;
  return text.split(/\s+/).map(w => SLANG[w] || w).join(' ');
}

/* ----------------- Basic math parser/executor -----------------
   Supports simple expressions, + - * / ^, parentheses, basic functions:
   sqrt, sin, cos, tan, log, ln, abs, round, floor, ceil.
   Also handles simple algebraic forms like "derivative" not supported.
*/
function safeEvalMath(expr){
  try{
    // normalize common tokens
    let s = expr.replace(/×/g,'*').replace(/÷/g,'/').replace(/—/g,'-');
    // block unsafe words
    if(/[a-zA-Z_$][\w$]*\s*\(/.test(s) && !/sqrt|sin|cos|tan|log|ln|abs|round|floor|ceil|pow/.test(s)) {
      // avoid eval of unknown identifiers
      // fallback: attempt simple numeric parse
    }
    // replace math words
    s = s.replace(/\bpi\b/gi, Math.PI).replace(/\be\b/gi, Math.E);
    // allow limited functions
    const fns = {
      sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
      log: Math.log10 ? Math.log10 : (x=>Math.log(x)/Math.LN10), ln: Math.log,
      abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, pow: Math.pow
    };
    // create safe function environment
    const argNames = Object.keys(fns);
    const argVals = Object.values(fns);
    // create function to evaluate
    const fn = new Function(...argNames, `"use strict"; return (${s});`);
    const res = fn(...argVals);
    if(Number.isFinite(res)) return res;
    return null;
  }catch(e){
    return null;
  }
}

/* ----------------- Memory & storage ----------------- */
const STORE = { MEM:'aru_memory_v2', PREFS:'aru_prefs_v2', KB_META:'aru_kb_meta_v2' };
let MEMORY = loadJSON(STORE.MEM) || { user:{name:null}, facts:{}, seen:0, lastSeen:null };
let PREFS = loadJSON(STORE.PREFS) || { personality:'friendly' };

function saveJSON(k,obj){ try{ localStorage.setItem(k, JSON.stringify(obj)); }catch(e){ console.warn('save fail',e);} }
function loadJSON(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } }

function saveMemoryFact(subject, prop, value){
  const key = normalize(subject);
  MEMORY.facts[key] = MEMORY.facts[key] || {};
  MEMORY.facts[key][prop] = { value, ts: preciseNow() };
  MEMORY.lastSeen = new Date().toISOString();
  MEMORY.seen = (MEMORY.seen||0) + 1;
  saveJSON(STORE.MEM, MEMORY);
  // also store in IDB memory for large-scale
  idbPutMemory(key, MEMORY.facts[key]).catch(()=>{});
}

/* ----------------- ARU identity ----------------- */
const ARU = {
  name: 'Aru',
  intro: "I'm Aru — an advanced browser brain. I answer from my library and what you teach me.",
  personalities: {
    friendly: s => rand([s, `🙂 ${s}`, `${s} Anything else?`]),
    playful: s => rand([`✨ ${s}`, `${s} lol`, `fun fact: ${s}`]),
    neutral: s => s,
    dry: s => rand([`Answer: ${s}`, s])
  },
  style: function(text){ const fn = this.personalities[PREFS.personality] || this.personalities.friendly; return fn(text); }
};

/* ----------------- Basic built-in KB (small starter) ----------------- */
let KB = {
  entities: {
    japan:{ type:'country', capital:'Tokyo', population:'~125 million', language:'Japanese' },
    earth:{ type:'planet', age:'~4.54 billion years', position:'3rd from Sun' },
    einstein:{ type:'person', name:'Albert Einstein', born:'1879', field:'Physics', known:'theory of relativity' },
    water:{ type:'compound', formula:'H2O', boiling:'100°C', freezing:'0°C' }
  },
  topics:{
    ai: "Artificial intelligence is the development of computer systems to perform tasks that normally require human intelligence.",
    gravity: "Gravity is a force by which objects with mass attract one another."
  },
  patterns:[
    {
      q:/\bcapital(?:\s+of)?\s+(?<country>[\w\s\-]+)\??/i,
      a: ({country}) => {
        const k = findEntityKey(country);
        if(!k) return null;
        const e = KB.entities[k];
        if(e && e.capital) return `The capital of ${titleCase(k)} is ${e.capital}.`;
        return null;
      }
    },
    {
      q:/\bwho\s+is\s+(?<p>[\w\s\-]+)\??/i,
      a: ({p})=>{
        const k = findEntityKey(p);
        if(!k) return null;
        const e = KB.entities[k];
        if(e && e.type==='person'){
          const parts = [];
          if(e.name) parts.push(e.name);
          if(e.field) parts.push(`${e.field} figure`);
          if(e.known) parts.push(`known for ${e.known}`);
          if(e.born) parts.push(`(born ${e.born})`);
          return parts.join(', ') + '.';
        }
        return null;
      }
    }
  ]
};
const BUILTIN_KB = JSON.parse(JSON.stringify(KB));

/* ----------------- IndexedDB for big knowledge (chunks + postings + minhash signatures) ----------------- */
const IDB_NAME = 'aru_kb_v2';
const IDB_VER = 1;
let idb = null;

function openIDB(){
  return new Promise((resolve,reject)=>{
    if(idb) return resolve(idb);
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath:'id' });
      if(!db.objectStoreNames.contains('postings')) db.createObjectStore('postings', { keyPath:'term' });
      if(!db.objectStoreNames.contains('signatures')) db.createObjectStore('signatures', { keyPath:'id' }); // stores minhash signature arrays
      if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath:'k' });
      if(!db.objectStoreNames.contains('memory')) db.createObjectStore('memory', { keyPath:'k' });
    };
    req.onsuccess = ()=> { idb = req.result; resolve(idb); };
    req.onerror = ()=> reject(req.error);
  });
}

async function idbPutChunk(chunk){
  const db = await openIDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(['chunks'],'readwrite');
    tx.objectStore('chunks').put(chunk);
    tx.oncomplete = ()=> res(true);
    tx.onerror = ()=> rej(tx.error);
  });
}
async function idbGetChunk(id){
  const db = await openIDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction('chunks','readonly');
    const r = tx.objectStore('chunks').get(id);
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}
async function idbPutPosting(term, postingArray){
  const db = await openIDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(['postings'],'readwrite');
    tx.objectStore('postings').put({ term, postings: postingArray });
    tx.oncomplete = ()=> res(true);
    tx.onerror = ()=> rej(tx.error);
  });
}
async function idbGetPosting(term){
  const db = await openIDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction('postings','readonly');
    const r = tx.objectStore('postings').get(term);
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}
async function idbPutSignature(id, sig){
  const db = await openIDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(['signatures'],'readwrite');
    tx.objectStore('signatures').put({ id, sig });
    tx.oncomplete = ()=> res(true);
    tx.onerror = ()=> rej(tx.error);
  });
}
async function idbGetSignature(id){
  const db = await openIDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction('signatures','readonly');
    const r = tx.objectStore('signatures').get(id);
    r.onsuccess = ()=> res(r.result && r.result.sig);
    r.onerror = ()=> rej(r.error);
  });
}
async function idbPutMemory(k,val){ try{ const db = await openIDB(); const tx = db.transaction('memory','readwrite'); tx.objectStore('memory').put({ k, v: val, ts: preciseNow() }); }catch(e){} }

/* ----------------- MinHash + LSH helpers (client side) -----------------
   Signatures are arrays of 32-bit integers.
   LSH search on client side requires index of buckets -> chunk ids.
   Preprocessor builds signatures and LSH buckets; client can import both.
*/
function jshash32(str, seed=0){
  // simple 32-bit hash for shingles
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
  // create k hash functions via seed variation; compute min per hash
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
function jaccardEstimate(sigA, sigB){
  if(!sigA || !sigB) return 0;
  let same = 0; for(let i=0;i<sigA.length;i++) if(sigA[i] === sigB[i]) same++;
  return same / sigA.length;
}

/* ----------------- Import chunks (chunks.json format) -----------------
   Expected chunk entry: { id, title, text, shingles?: [str], signature?: [int] }
   The preprocessor will produce shingles & signature. If signature missing, we can compute but slow.
*/
async function importKBFile(file){
  try{
    const text = await file.text();
    const obj = JSON.parse(text);
    if(!Array.isArray(obj)) throw new Error('KB file must be array of chunks');
    // chunk structure: id, title, text, shingles (optional), signature (optional)
    // We'll import in batches to avoid UI freeze
    const batchSize = 150;
    for(let i=0;i<obj.length;i+=batchSize){
      const batch = obj.slice(i, i+batchSize);
      await Promise.all(batch.map(async ch=>{
        await idbPutChunk(ch);
        // postings
        const terms = Array.from(new Set(tokenize(ch.text)));
        for(const t of terms){
          try{
            const existing = await idbGetPosting(t);
            if(!existing) await idbPutPosting(t, [ch.id]);
            else {
              if(!existing.postings.includes(ch.id)){
                existing.postings.push(ch.id);
                await idbPutPosting(t, existing.postings);
              }
            }
          }catch(e){}
        }
        // store signature if present
        if(ch.signature) await idbPutSignature(ch.id, ch.signature);
      }));
      // small pause so browser remains responsive
      await sleep(30);
    }
    alert(`KB import completed: ${obj.length} chunks added.`);
    // store meta with count
    saveJSON(STORE.KB_META, { imported_chunks: obj.length, ts: new Date().toISOString() });
  }catch(e){
    console.error(e);
    alert('KB import failed: ' + (e.message || e));
  }
}

/* ----------------- TF-IDF-ish search + MinHash fallback ----------------- */
async function retrieveRelevant(query, topK=6){
  const qnorm = normalize(expandSlang(query));
  // 1) try builtin entity/topic quick matches
  const results = [];
  const ent = findEntityKey(qnorm);
  if(ent){
    const e = KB.entities[ent];
    const blurb = Object.entries(e).filter(([k])=>k!=='type').slice(0,4).map(([k,v])=>`${titleCase(k)}: ${v}`).join('; ');
    results.push({ id:`entity:${ent}`, title: titleCase(ent), text: blurb, score: 999 });
  }
  const topic = findTopicKey(qnorm);
  if(topic) results.push({ id:`topic:${topic}`, title:titleCase(topic), text: KB.topics[topic], score:998 });

  // 2) postings-based candidate gather
  try{
    await openIDB();
    const qterms = Array.from(new Set(tokenize(qnorm)));
    const postings = await Promise.all(qterms.map(t => idbGetPosting(t)));
    const counts = {};
    let totalCount = await idbCount('chunks').catch(()=>1000);
    postings.forEach((p,idx)=>{
      if(!p) return;
      const idf = Math.log(1 + (totalCount / Math.max(1, p.postings.length)));
      p.postings.forEach(id => counts[id] = (counts[id]||0) + idf);
    });
    // take candidates
    const cand = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0, topK*8).map(x=>x[0]);
    // fetch chunk texts and refine by overlap
    const chunks = await Promise.all(cand.map(id => idbGetChunk(id)));
    const qset = new Set(qterms);
    const refined = chunks.filter(Boolean).map(ch=>{
      const chTerms = new Set(tokenize(ch.text));
      let overlap = 0; for(const t of qset) if(chTerms.has(t)) overlap++;
      const base = counts[ch.id] || 0;
      return { id: ch.id, title: ch.title, text: ch.text, score: base + (overlap/(1+chTerms.size)) };
    }).sort((a,b)=>b.score - a.score).slice(0, topK);
    results.push(...refined);
  }catch(e){
    // IDB missing or empty; ignore
  }

  // 3) MinHash LSH paraphrase search (if we have signatures)
  try{
    const qshingles = shinglesFromText(qnorm);
    const qsig = minhashSignatureFromShingles(qshingles, 128);
    // We'll scan a small subset of signatures (for demo) or rely on LSH index (if present)
    // Attempt: scan all signatures (only safe if few), else sample via postings above
    const meta = loadJSON(STORE.KB_META) || {};
    const importedCount = meta.imported_chunks || 0;
    let sigHits = [];
    if(importedCount && importedCount < 5000){
      // safe to scan
      const db = await openIDB();
      const tx = db.transaction('signatures','readonly');
      const store = tx.objectStore('signatures');
      const req = store.openCursor();
      await new Promise((res,rej)=>{
        req.onsuccess = async (ev) => {
          const cur = ev.target.result;
          if(cur){
            const { id, sig } = cur.value;
            const est = jaccardEstimate(qsig, sig);
            if(est > 0.18) sigHits.push({ id, est });
            cur.continue();
          } else res();
        };
        req.onerror = ()=> res();
      });
    } else {
      // large DB: check signatures for candidates only among previous postings-based candidates
      // (this requires candidate list - we used refined earlier)
    }
    // fetch top signature matches
    sigHits.sort((a,b)=>b.est - a.est);
    const topSigIds = sigHits.slice(0,6).map(x=>x.id);
    const sigChunks = await Promise.all(topSigIds.map(id=>idbGetChunk(id)));
    for(const ch of sigChunks.filter(Boolean)){
      results.push({ id:ch.id, title:ch.title, text:ch.text, score: 50 }); // boost a bit
    }
  }catch(e){ /* silent */ }

  // 4) dedupe and sort
  const uniq = {};
  for(const r of results){
    if(!r) continue;
    if(!uniq[r.id] || uniq[r.id].score < r.score) uniq[r.id] = r;
  }
  const out = Object.values(uniq).sort((a,b)=>b.score - a.score).slice(0, topK);
  return out;
}

/* helper: count store */
async function idbCount(storeName){
  const db = await openIDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(storeName,'readonly');
    const r = tx.objectStore(storeName).count();
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}

/* shingles for MinHash */
function shinglesFromText(text, k=5){
  const s = normalize(text).replace(/\s+/g,' ');
  const out = [];
  for(let i=0;i+ k <= s.length;i++){
    out.push(s.slice(i, i+k));
  }
  return Array.from(new Set(out));
}

/* ----------------- Synthesis ----------------- */
function synthesizeAnswer(query, retrieved){
  if(!retrieved || retrieved.length===0) return null;
  // pick top 2 sentences that contain most query tokens
  const qterms = new Set(tokenize(normalize(query)));
  const sentences = [];
  for(const r of retrieved){
    const sents = r.text.split(/(?<=[.?!])\s+/).filter(Boolean);
    let best = null, score=-1;
    for(const s of sents){
      const toks = new Set(tokenize(s));
      let overlap = 0; qterms.forEach(t=>{ if(toks.has(t)) overlap++;});
      const sc = overlap + (toks.size<=20 ? 0.1 : 0);
      if(sc>score){ score=sc; best=s; }
    }
    if(best) sentences.push({ text: best.trim(), src: r.title || r.id, score: score + (r.score||0) });
    else sentences.push({ text: r.text.slice(0,200).trim(), src: r.title||r.id, score: r.score||0 });
  }
  sentences.sort((a,b)=>b.score - a.score);
  const chosen = sentences.slice(0,2).map(s=>s.text);
  const cite = sentences[0] && sentences[0].src ? ` (source: ${sentences[0].src})` : '';
  return chosen.join(' ') + cite;
}

/* ----------------- Knowledge helpers ----------------- */
function findEntityKey(q){
  if(!q) return null;
  const n = normalize(q);
  if(KB.entities[n]) return n;
  const keys = Object.keys(KB.entities);
  const exact = keys.find(k => n === k);
  if(exact) return exact;
  const partial = keys.find(k => n.includes(k) || k.includes(n));
  if(partial) return partial;
  let best=null,bd=1e9;
  for(const k of keys){ const d = levenshtein(n,k); if(d<bd){bd=d;best=k;} }
  return bd<=2?best:null;
}
function findTopicKey(q){
  if(!q) return null;
  const n = normalize(q);
  const keys = Object.keys(KB.topics);
  const hit = keys.find(k => n.includes(k) || k.includes(n));
  if(hit) return hit;
  for(const k of keys) if(isClose(k,n)) return k;
  return null;
}
function lookupProp(obj, prop){
  if(!obj || !prop) return null;
  if(obj[prop]) return obj[prop];
  let best=null,bd=1e9;
  for(const k of Object.keys(obj)){ const d = levenshtein(prop,k); if(d<bd){bd=d;best=k;} }
  if(bd<=2) return obj[best];
  return null;
}

/* ----------------- Levenshtein ----------------- */
function levenshtein(a,b){
  a = a||''; b = b||'';
  const m = Array.from({length:a.length+1},(_,i)=>[]);
  for(let i=0;i<=a.length;i++) m[i][0]=i;
  for(let j=0;j<=b.length;j++) m[0][j]=j;
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+cost);
    }
  }
  return m[a.length][b.length];
}
function isClose(a,b,thr=2){ return levenshtein(a,b) <= thr; }

/* ----------------- Memory answer fallback ----------------- */
function memoryAnswer(text){
  if(/\b(who am i|what(?:'s| is) my name)\b/.test(text)){
    if(MEMORY.user.name) return `You said your name is ${MEMORY.user.name}.`;
    return `I don't know your name yet. Tell me: "my name is ..."`;
  }
  for(const subj of Object.keys(MEMORY.facts || {})){
    if(text.includes(subj)){
      const props = MEMORY.facts[subj];
      const k = Object.keys(props || {})[0];
      if(k) return `${titleCase(subj)} — ${titleCase(k)}: ${props[k].value || props[k]}.`;
    }
  }
  return null;
}

/* ----------------- Ask to teach ----------------- */
function askToTeach(text){
  return rand([
    `I don't have that in my library yet. Want to teach me? Say "remember that X is Y".`,
    `Hmm, new topic. You can say "remember that [subject] is [fact]" and I'll save it.`,
    `I couldn't find that. If you teach me, I'll remember.`
  ]);
}

/* ----------------- Core brain pipeline ----------------- */
const INTENTS = [
  { name:'greeting', test: t => hasAny(t, SYN.hello || ['hello','hi']) },
  { name:'farewell', test: t => hasAny(t, SYN.bye || ['bye','farewell']) },
  { name:'thanks', test: t => hasAny(t, SYN.thanks || ['thanks','thank']) },
  { name:'ask_time', test: t => /\btime\b/.test(t) && /\bwhat\b/.test(t) },
  { name:'bot_name', test: t => /\byour\s+name\b|\bwho\s+are\s+you\b/.test(t) },
  { name:'tell_name', test: t => /\bmy\s+name\s+is\s+([\w\-\s']+)/i.test(t) },
  { name:'teach_is', test: t => /\bremember\s+that\s+(.+?)\s+is\s+(.+)\b/i.test(t) || /\b(.+?)\s+is\s+(.+)\b/i.test(t) }
];

function hasAny(text, arr){
  for(const w of arr) if(new RegExp('\\b'+escapeRegExp(w)+'\\b','i').test(text)) return true;
  return false;
}

async function brain(userRaw){
  const raw = String(userRaw || '');
  const expanded = expandSlang(raw);
  const n = normalize(expanded);

  // 1) math quick parse
  const maybeMath = n.match(/^[0-9\.\s\+\-\*\/\^\(\)×÷eπpi]+$/i) || n.match(/(calculate|what is|solve)\s+(.+)/i);
  if(maybeMath){
    // try extract expression
    let expr = raw;
    const m = raw.match(/(?:calculate|what is|solve)\s+(.+)/i);
    if(m) expr = m[1];
    const val = safeEvalMath(expr);
    if(val !== null && val !== undefined) return ARU.style(`${expr.trim()} = ${val}`);
  }

  // 2) intents
  for(const intent of INTENTS){
    if(intent.test(n)){
      const out = handleIntent(intent.name, n);
      if(out) return ARU.style(out);
    }
  }

  // 3) pattern rules
  for(const p of KB.patterns){
    const m = n.match(p.q);
    if(m){
      const res = p.a(m.groups || {});
      if(res) return ARU.style(res);
    }
  }

  // 4) property probing
  const prop = extractPropQuery(n);
  if(prop){
    const ek = findEntityKey(prop.entityGuess);
    if(ek){
      const val = lookupProp(KB.entities[ek], prop.propGuess) || (MEMORY.facts[ek] && MEMORY.facts[ek][prop.propGuess] && MEMORY.facts[ek][prop.propGuess].value);
      if(val) return ARU.style(`${titleCase(ek)} — ${titleCase(prop.propGuess)}: ${val}.`);
    }
  }

  // 5) memory lookup
  const mem = memoryAnswer(n);
  if(mem) return ARU.style(mem);

  // 6) retrieval
  const retrieved = await retrieveRelevant(n, 6);
  if(retrieved && retrieved.length){
    const s = synthesizeAnswer(n, retrieved);
    if(s) return ARU.style(s);
  }

  // 7) fallback teach
  return ARU.style(askToTeach(n));
}

/* ----------------- Extract prop guess ----------------- */
function extractPropQuery(text){
  const words = tokenize(text);
  if(words.length < 2) return null;
  for(let split=1; split<words.length; split++){
    const propGuess = words.slice(0,split).join(' ');
    const entityGuess = words.slice(split).join(' ');
    const ek = findEntityKey(entityGuess);
    if(ek) return { entityGuess, propGuess };
  }
  return null;
}

/* ----------------- Intent handlers ----------------- */
function handleIntent(name, text){
  if(name==='greeting') return `Hello ${MEMORY.user.name || 'there'}!`;
  if(name==='farewell') return `Goodbye!`;
  if(name==='thanks') return `You're welcome.`;
  if(name==='ask_time') return `It's ${new Date().toLocaleTimeString()} on ${new Date().toLocaleDateString()}.`;
  if(name==='bot_name') return `I am ${ARU.name}. ${ARU.intro}`;
  if(name==='tell_name'){
    const m = text.match(/\bmy\s+name\s+is\s+([\w\-\s']+)/i);
    if(m){ const nm = titleCase(m[1].trim()); MEMORY.user.name = nm; saveJSON(STORE.MEM, MEMORY); return `Nice to meet you, ${nm}. I'll remember that.`; }
  }
  if(name==='teach_is'){
    let m = text.match(/\bremember\s+that\s+(.+?)\s+is\s+(.+)\b/i);
    if(!m) m = text.match(/\b(.+?)\s+is\s+(.+)\b/i);
    if(m){ const subj = m[1].trim(); const val = m[2].trim(); saveMemoryFact(subj,'is',val); return `Saved: ${titleCase(subj)} is ${val}.`; }
  }
  return null;
}

/* ----------------- UI functions ----------------- */
function addMessage(role, text){
  const li = document.createElement('li');
  li.className = `msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${role === 'user' ? 'You' : ARU.name} • ${nowClock()}`;
  li.appendChild(bubble); li.appendChild(meta);
  messagesEl.appendChild(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function setTyping(v){ typingEl.classList.toggle('hidden', !v); }

async function botSay(text){
  setTyping(true);
  const ms = clamp(300 + (text.length * 6), 400, 1800);
  await sleep(ms);
  addMessage('bot', text);
  setTyping(false);
}

/* ----------------- Input handling ----------------- */
async function handleUserInput(e){
  e.preventDefault();
  const raw = inputEl.value.trim();
  if(!raw) return;
  addMessage('user', raw);
  inputEl.value = '';
  MEMORY.seen = (MEMORY.seen || 0) + 1;
  MEMORY.lastSeen = new Date().toISOString();
  saveJSON(STORE.MEM, MEMORY);

  // local teach quick (fast path)
  const teach = clientTeach(raw);
  if(teach){ await botSay(ARU.style(teach)); return; }

  const reply = await brain(raw);
  await botSay(reply);
}

/* quick local teach */
function clientTeach(text){
  const t = normalize(text);
  let m;
  if(m = t.match(/\bmy\s+name\s+is\s+([\w\-\s']+)/i)){
    const nm = titleCase(m[1].trim()); MEMORY.user.name = nm; saveJSON(STORE.MEM, MEMORY); return `Nice to meet you, ${nm}. I'll remember that.`;
  }
  if(m = t.match(/\bremember\s+that\s+(.+?)\s+is\s+(.+)\b/i)){
    const subj = m[1].trim(), val = m[2].trim(); saveMemoryFact(subj,'is',val); return `Saved: ${titleCase(subj)} is ${val}.`;
  }
  // "X is Y" short form
  if(m = t.match(/\b(.{1,40}?)\s+is\s+(.{1,200})\b/i)){
    const subj = m[1].trim(), val = m[2].trim();
    if(!subj.includes('what') && subj.split(/\s+/).length < 6){ saveMemoryFact(subj,'is',val); return `Noted: ${titleCase(subj)} is ${val}.`; }
  }
  return null;
}

/* ----------------- Event wiring ----------------- */
formEl.addEventListener('submit', handleUserInput);
personaEl.addEventListener('change', ()=> { PREFS.personality = personaEl.value; saveJSON(STORE.PREFS, PREFS); });

btnExportMem.addEventListener('click', ()=> downloadJSON('aru-memory.json', MEMORY));
btnImportMem.addEventListener('click', ()=> fileImportMem.click());
fileImportMem.addEventListener('change', ()=> {
  const f = fileImportMem.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ()=>{ try{ MEMORY = JSON.parse(r.result); saveJSON(STORE.MEM, MEMORY); botSay('Memory imported.'); }catch{ botSay('Import failed.'); } };
  r.readAsText(f);
});

btnExportKnow.addEventListener('click', ()=> downloadJSON('aru-knowledge.json', KB));
btnImportKnow.addEventListener('click', ()=> fileImportKnow.click());
fileImportKnow.addEventListener('change', ()=> {
  const f = fileImportKnow.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = async ()=> {
    try{
      const obj = JSON.parse(r.result);
      if(Array.isArray(obj) && obj.length && obj[0].id && obj[0].text){
        // chunk array -> import into IDB
        await importKBFile(f);
      } else {
        KB = obj; saveJSON(STORE.KB_META, { imported_kb_object: true, ts: new Date().toISOString() }); botSay('Knowledge object imported.');
      }
    }catch(e){ botSay('Import failed: invalid JSON.'); }
  };
  r.readAsText(f);
});

btnReset.addEventListener('click', async ()=> {
  if(confirm('Clear chat, memory, and imported knowledge?')){
    localStorage.removeItem(STORE.MEM); localStorage.removeItem(STORE.PREFS); localStorage.removeItem(STORE.KB_META);
    MEMORY = { user:{name:null}, facts:{}, seen:0, lastSeen:null }; PREFS = { personality:'friendly' }; KB = JSON.parse(JSON.stringify(BUILTIN_KB));
    // clear IDB
    try{ const db = await openIDB(); const t = db.transaction(['chunks','postings','signatures','memory'],'readwrite'); t.objectStore('chunks').clear(); t.objectStore('postings').clear(); t.objectStore('signatures').clear(); t.objectStore('memory').clear(); }catch(e){}
    messagesEl.innerHTML = ''; addMessage('bot','Memory and KB cleared.');
  }
});

btnAbout.addEventListener('click', ()=> botSay(`${ARU.intro} I run in your browser, use local knowledge packs, and can be taught.`));

/* ----------------- Download helper ----------------- */
function downloadJSON(filename,obj){
  const blob = new Blob([JSON.stringify(obj,null,2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

/* ----------------- Startup greeting ----------------- */
async function greet(){
  PREFS = loadJSON(STORE.PREFS) || PREFS;
  personaEl.value = PREFS.personality || 'friendly';
  const first = (MEMORY.seen||0) === 0;
  if(first) await botSay(`Hi — I'm ${ARU.name}. ${ARU.intro} Ask me anything (math, facts, slang), or import bigger knowledge packs to expand me.`);
  else await botSay(`Welcome back${MEMORY.user.name ? ', ' + MEMORY.user.name : ''}! Ready when you are.`);
}
greet();

/* ===================== END OF script.js ===================== */
