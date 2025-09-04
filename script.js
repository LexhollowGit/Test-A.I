/* ===================================================================
   ARU — Self-contained Browser Brain (script.js)
   - No APIs, no external models.
   - Retrieval (TF-IDF + fuzzy), memory, teaching, import/export, IndexedDB.
   - High-precision timestamps for memory using performance.now().
   - Place in your repo as script.js alongside index.html and style.css.
   =================================================================== */

/* ===================== DOM SELECTORS (matches earlier index.html) */
const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages");
const typingEl = $("#typing");
const inputEl = $("#user-input");
const formEl = $("#composer");
const personaEl = $("#personality");

const btnExportMem = $("#btn-export-mem");
const btnImportMem = $("#btn-import-mem");
const fileImportMem = $("#file-import-mem");
const btnExportKnow = $("#btn-export-know");
const btnImportKnow = $("#btn-import-know");
const fileImportKnow = $("#file-import-know");
const btnReset = $("#btn-reset");
const btnAbout = $("#btn-about");

/* ===================== Utilities ===================== */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowClock = () => new Date().toLocaleTimeString();
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* high-precision time stamp (fractional ms) */
function preciseNow(){
  // combine performance.now() (fractional ms) with Date.now() (ms since epoch) to get a high-precision epoch-like value
  // Note: performance.timeOrigin + performance.now() would be even better in supporting browsers.
  const perf = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
  const base = (typeof performance !== "undefined" && performance.timeOrigin) ? performance.timeOrigin : Date.now();
  return base + perf; // fractional ms timestamp (epoch + fraction)
}

/* ===================== Tiny NLP helpers ===================== */
function normalize(text){
  if(!text) return "";
  return String(text)
    .normalize('NFKC')
    .replace(/[“”‘’]/g, '"')
    .replace(/[_••†◆★✦●■◆]/g,' ')
    .replace(/[^\p{L}\p{N}\s'\-]/gu,' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
}

function tokenize(text){
  return normalize(text).split(/\s+/).filter(Boolean);
}

function stem(word){
  // extremely small stemmer for English-like words
  return word.replace(/(ing|ed|ly|ness|ment|ers|er|s)$/, '').replace(/ies$/,'y');
}

function titleCase(str){
  return String(str).replace(/\b\w/g,c=>c.toUpperCase());
}

/* fuzzy distance (Levenshtein) — used sparingly for candidate checking */
function levenshtein(a,b){
  a = a||''; b = b||'';
  const m = Array.from({length:a.length+1},(_,i)=>[]);
  for(let i=0;i<=a.length;i++) m[i][0]=i;
  for(let j=0;j<=b.length;j++) m[0][j]=j;
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      const cost = a[i-1]===b[j-1] ? 0 : 1;
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+cost);
    }
  }
  return m[a.length][b.length];
}
function isClose(a,b,thr=2){ return levenshtein(a,b) <= thr; }

/* ===================== Synonyms & Slang (starter, extensible) ===================== */
const SLANG = {
  "u":"you","ur":"your","y":"why","r":"are","wtf":"what the fuck","brb":"be right back",
  "idk":"i don't know","imo":"in my opinion","imo":"in my opinion","afaik":"as far as i know",
  "gonna":"going to","wanna":"want to","gotta":"got to","tho":"though","cuz":"because","thx":"thanks",
  "pls":"please","plz":"please","omw":"on my way","lmk":"let me know","bruh":"bro","ya":"you","yall":"you all"
};
const SYNONYMS = {
  "hello":["hi","hey","yo","hiya","sup"],
  "bye":["goodbye","see ya","later","cya"],
  "thanks":["thank you","thx","ty"],
  "time":["time","clock","date"],
  "capital":["capital","capital of","metropolis"]
};

/* expand slang and synonyms during normalization */
function expandSlangAndMap(text){
  if(!text) return text;
  const toks = text.split(/\s+/);
  return toks.map(t => SLANG[t] || t).join(' ');
}

/* ===================== Small builtin knowledge pack =====================
   This is a reasonably sized starter pack. Add entries, or import large packs.
   Structure:
     KB: { entities: { key: { prop: value, ... } }, topics: {topic: blurb}, patterns: [{q:regex, a:function(groups)=>string}] }
*/
let KB = {
  entities: {
    japan: { type:"country", capital:"Tokyo", population:"~125 million", language:"Japanese", region:"Asia" },
    philippines: { type:"country", capital:"Manila", population:"~114 million", language:"Filipino, English", region:"Southeast Asia" },
    earth: { type:"planet", age:"~4.54 billion years", orbit:"Sun", position:"3rd from Sun" },
    sun: { type:"star", class:"G-type main-sequence", distance:"~149.6 million km (1 AU) from Earth" },
    einstein: { type:"person", name:"Albert Einstein", born:"1879", field:"Physics", known:"theory of relativity" },
    newton: { type:"person", name:"Isaac Newton", born:"1643", field:"Physics", known:"laws of motion & gravity" },
    water: { type:"compound", formula:"H2O", boiling:"100°C (1 atm)", freezing:"0°C (1 atm)" },
    moon: { type:"moon", orbits:"Earth", distance:"~384,400 km", period:"~27.3 days" }
  },
  topics: {
    "ai": "Artificial intelligence is a branch of computer science that builds systems able to perform tasks normally requiring human intelligence.",
    "photosynthesis": "Photosynthesis is the process plants use to convert light energy into chemical energy, producing oxygen and glucose from carbon dioxide and water.",
    "gravity": "Gravity is a natural phenomenon by which all things with mass are attracted to one another, keeping planets in orbit and objects grounded.",
    "internet": "The internet is a global network that connects computers and devices using standardized protocols for communication."
  },
  patterns: [
    {
      q: /\bcapital(?:\s+of)?\s+(?<country>[\w\s\-]+)\??/i,
      a: ({country}) => {
        const k = findEntityKey(country);
        if(!k) return null;
        const e = KB.entities[k];
        if(e && e.capital) return `The capital of ${titleCase(k)} is ${e.capital}.`;
        return null;
      }
    },
    {
      q: /\bwho\s+is\s+(?<person>[\w\s\-]+)\??/i,
      a: ({person}) => {
        const k = findEntityKey(person);
        const e = k && KB.entities[k];
        if(e && e.type === 'person'){
          const bits = [];
          if(e.name) bits.push(e.name);
          if(e.field) bits.push(`${e.field} figure`);
          if(e.known) bits.push(`known for ${e.known}`);
          if(e.born) bits.push(`(born ${e.born})`);
          return bits.join(", ") + ".";
        }
        return null;
      }
    },
    {
      q: /\bwhat\s+is\s+(?<topic>[\w\s\-]+)\??/i,
      a: ({topic}) => {
        const tk = findTopicKey(topic);
        if(tk) return KB.topics[tk];
        const ek = findEntityKey(topic);
        if(ek){
          const e = KB.entities[ek];
          const blurb = Object.entries(e).filter(([k])=>k!=='type').slice(0,3).map(([k,v])=>`${titleCase(k)}: ${v}`).join("; ");
          return `${titleCase(ek)} — ${blurb}.`;
        }
        return null;
      }
    }
  ]
};

/* Keep backup for reset */
const BUILTIN_KB = JSON.parse(JSON.stringify(KB));

/* ===================== Storage keys & memory ===================== */
const STORE = {
  MEM: 'aru_memory_v1',
  PREFS: 'aru_prefs_v1',
  KB_CUSTOM: 'aru_kb_custom_v1'
};

let MEMORY = loadJSON(STORE.MEM) || {
  user: { name: null, favorites: {} },
  facts: {},       // arbitrary facts learned by user: { subject: {prop: value, meta...} }
  seen: 0,
  lastSeen: null,
  history: []      // short local history snapshot
};

let PREFS = loadJSON(STORE.PREFS) || { personality: 'friendly' };

/* Quick persistence helpers */
function saveJSON(k, obj){ try { localStorage.setItem(k, JSON.stringify(obj)); } catch(e){ console.warn('save failed', e); } }
function loadJSON(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } }

/* Update save memory with a precise timestamp (fractional ms) */
function saveMemoryEntry(subject, prop, value){
  const key = normalize(subject);
  MEMORY.facts[key] = MEMORY.facts[key] || {};
  MEMORY.facts[key][prop] = { value, ts: preciseNow() };
  MEMORY.lastSeen = new Date().toISOString();
  MEMORY.seen = (MEMORY.seen || 0) + 1;
  saveJSON(STORE.MEM, MEMORY);
  // also store into IndexedDB memory store asynchronously for larger persists (see below)
  try { idbPutMemory(key, MEMORY.facts[key]); } catch(e){}
}

/* ===================== IDB: optional bigger storage for KB & memory ===================== */
const IDB_NAME = 'aru_idb_v1';
const IDB_VERSION = 1;
let idb = null;

function openIDB(){
  return new Promise((resolve, reject) => {
    if(idb) return resolve(idb);
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if(!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'id' });
      if(!db.objectStoreNames.contains('postings')) db.createObjectStore('postings', { keyPath: 'term' });
      if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      if(!db.objectStoreNames.contains('memory')) db.createObjectStore('memory', { keyPath: 'k' });
    };
    req.onsuccess = ()=> { idb = req.result; resolve(idb); };
    req.onerror = ()=> reject(req.error);
  });
}
async function idbPutMemory(k, value){
  try{
    const db = await openIDB();
    const tx = db.transaction('memory','readwrite');
    tx.objectStore('memory').put({ k, value, ts: preciseNow() });
    return tx.complete;
  }catch(e){ console.warn('idb mem put', e); }
}

/* ===================== Message UI helpers ===================== */
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
function setTyping(val){ typingEl.classList.toggle('hidden', !val); }

/* ===================== ARU Identity & personalities ===================== */
const ARU = {
  name: "Aru", // locked in per your request
  intro: "I am Aru — a browser brain. I don't use external APIs or models; I answer from my library and what you teach me.",
  personalities: {
    friendly: (s) => rand([s, `🙂 ${s}`, `${s} Anything else?`]),
    playful: (s) => rand([`✨ ${s}`, `${s} lol`, `fun fact: ${s}`]),
    neutral: (s) => s,
    dry: (s) => rand([`Answer: ${s}`, s])
  },
  respondStyle: function(text){
    const p = PREFS.personality || 'friendly';
    const f = this.personalities[p] || this.personalities.friendly;
    return f(text);
  }
};

/* ===================== Intent detection ===================== */
const INTENTS = [
  { name:'greeting', test:(t)=> hasAny(t, SYNONYMS.hello || ['hello','hi','hey']) },
  { name:'farewell', test:(t)=> hasAny(t, SYNONYMS.bye || ['bye','farewell']) },
  { name:'thanks', test:(t)=> hasAny(t, SYNONYMS.thanks || ['thanks','thank']) },
  { name:'ask_time', test:(t)=> /\bwhat(?:'s| is)?\s+the\s+time\b/i.test(t) || /\btime\b/.test(t) },
  { name:'ask_bot_name', test:(t)=> /\bwho\s+are\s+you\b/i.test(t) || /\byour\s+name\b/i.test(t) },
  { name:'teach_is', test:(t)=> /\bremember\s+that\s+(.+?)\s+is\s+(.+)\b/i.test(t) || /\b(.+?)\s+is\s+(.+)\b/i.test(t) },
  { name:'tell_name', test:(t)=> /\bmy\s+name\s+is\s+([\w\-\s']+)/i.test(t) }
];

function hasAny(text, arr){
  if(!text) return false;
  for(const w of arr) if(new RegExp("\\b"+escapeRegExp(w)+"\\b","i").test(text)) return true;
  return false;
}
function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ===================== Core brain: route input -> response ===================== */
async function brain(userRaw){
  const raw = String(userRaw || '');
  const pre = expandSlangAndMap(raw);
  const normalized = normalize(pre);
  const toks = tokenize(normalized).map(stem);
  const bow = tokensToBag(toks);

  // 1) Fast intent handling
  for(const intent of INTENTS){
    if(intent.test(normalized)){
      const out = handleIntent(intent.name, normalized);
      if(out) return ARU.respondStyle(out);
    }
  }

  // 2) Run pattern rules in KB (regex-based)
  for(const rule of KB.patterns){
    const m = normalized.match(rule.q);
    if(m){
      try{
        const res = rule.a(m.groups || {});
        if(res) return ARU.respondStyle(res);
      }catch(e){}
    }
  }

  // 3) Entity/prop probing (e.g., "einstein born", "water boiling")
  const propQ = extractPropQuery(normalized);
  if(propQ){
    const { entityGuess, propGuess } = propQ;
    const ekey = findEntityKey(entityGuess);
    if(ekey){
      const val = lookupProp(KB.entities[ekey], propGuess) || lookupMemoryFact(ekey, propGuess);
      if(val) return ARU.respondStyle(`${titleCase(ekey)} — ${titleCase(propGuess)}: ${val}.`);
    }
  }

  // 4) Memory — check local learned facts
  const mem = memoryAnswer(normalized);
  if(mem) return ARU.respondStyle(mem);

  // 5) Full-text retrieval from built-in KB and imported chunks (IndexedDB)
  const retrieved = await retrieveRelevant(normalized, 4);
  if(retrieved && retrieved.length){
    const s = synthesizeAnswer(normalized, retrieved);
    return ARU.respondStyle(s);
  }

  // 6) Ask to teach / fallback
  return ARU.respondStyle(askToTeach(normalized));
}

/* ===================== Intent handlers ===================== */
function handleIntent(name, text){
  if(name === 'greeting') return `Hello ${MEMORY.user.name ? MEMORY.user.name : 'there'}!`;
  if(name === 'farewell') return `Goodbye — talk soon!`;
  if(name === 'thanks') return `You're welcome.`;
  if(name === 'ask_time') return `It's ${new Date().toLocaleTimeString()} on ${new Date().toLocaleDateString()}.`;
  if(name === 'ask_bot_name') return `I'm ${ARU.name}. ${ARU.intro}`;
  if(name === 'tell_name'){
    const m = text.match(/\bmy\s+name\s+is\s+([\w\-\s']+)/i);
    if(m){
      const nm = titleCase(m[1].trim());
      MEMORY.user.name = nm;
      saveJSON(STORE.MEM, MEMORY);
      return `Nice to meet you, ${nm}! I'll remember that.`;
    }
  }
  if(name === 'teach_is'){
    let m = text.match(/\bremember\s+that\s+(.+?)\s+is\s+(.+)\b/i);
    if(!m) m = text.match(/\b(.+?)\s+is\s+(.+)\b/i);
    if(m){
      const subj = m[1].trim();
      const pred = m[2].trim();
      saveMemoryEntry(subj, 'is', pred);
      return `Got it. ${titleCase(subj)} is ${pred}. I've saved that.`;
    }
  }
  return null;
}

/* ===================== Knowledge helpers (entities & topics) ===================== */
function findEntityKey(query){
  if(!query) return null;
  const q = normalize(query).replace(/\?$/,'');
  // Exact match
  if(KB.entities[q]) return q;
  // partial substring match
  const keys = Object.keys(KB.entities);
  let hit = keys.find(k => q.includes(k) || k.includes(q));
  if(hit) return hit;
  // fuzzy
  let best = null, bestD = 1e9;
  for(const k of keys){
    const d = levenshtein(q, k);
    if(d < bestD){ bestD = d; best = k; }
  }
  return bestD <= 2 ? best : null;
}

function findTopicKey(query){
  if(!query) return null;
  const q = normalize(query);
  const keys = Object.keys(KB.topics);
  let hit = keys.find(k => q.includes(k) || k.includes(q));
  if(hit) return hit;
  for(const k of keys) if(isClose(k,q)) return k;
  return null;
}

function lookupProp(obj, propQ){
  if(!obj || !propQ) return null;
  const direct = obj[propQ];
  if(direct) return direct;
  // fuzzy property match
  let best=null, bestD=1e9;
  for(const k of Object.keys(obj)){
    const d = levenshtein(propQ, k);
    if(d < bestD){ bestD = d; best = k; }
  }
  return bestD <= 2 ? obj[best] : null;
}

/* ===================== Extract property query helper ===================== */
function extractPropQuery(text){
  const words = tokenize(text);
  if(words.length < 2) return null;
  // try splits: [prop words] [entity words]
  for(let split=1; split<words.length; split++){
    const propGuess = words.slice(0,split).join(' ');
    const entityGuess = words.slice(split).join(' ');
    const ek = findEntityKey(entityGuess);
    if(ek) return { entityGuess, propGuess };
  }
  return null;
}

/* ===================== Memory question handling ===================== */
function memoryAnswer(text){
  if(/\b(who am i|what(?:'s| is) my name)\b/.test(text)){
    if(MEMORY.user.name) return `You said your name is ${MEMORY.user.name}.`;
    return `I don't know your name yet. Tell me: "my name is ..."`;
  }
  // check stored arbitrary facts
  for(const subj of Object.keys(MEMORY.facts || {})){
    if(text.includes(subj)){
      const props = MEMORY.facts[subj];
      const pkeys = Object.keys(props || {});
      if(pkeys.length){
        const p = pkeys[0];
        const entry = props[p];
        const display = (entry && entry.value) ? entry.value : entry;
        return `${titleCase(subj)} — ${titleCase(p)}: ${display}.`;
      }
    }
  }
  return null;
}

/* ===================== Ask to teach fallback ===================== */
function askToTeach(text){
  const prompts = [
    `I don't know about that yet. Want to teach me? Say "remember that X is Y".`,
    `That one's new to me. You can say "remember that [subject] is [fact]" and I'll save it.`,
    `I don't have that in my library. If you tell me, I will remember.`
  ];
  return rand(prompts);
}

/* ===================== Retrieval over imported KB (IndexedDB) & builtin KB ===================== */

/* tokens -> bag map */
function tokensToBag(tokens){
  const m = new Map();
  tokens.forEach(t => m.set(t, (m.get(t) || 0) + 1));
  return m;
}

/* Basic search pipeline:
   1) Search built-in KB (entities/topics) by name match
   2) Query IndexedDB chunks postings for candidate chunk ids
   3) Score candidates by simple TF-IDF-ish score (using idf inferred from postings sizes)
*/
async function retrieveRelevant(query, topK=5){
  const qnorm = normalize(expandSlangAndMap(query));
  // 1) check built-in topic/entity matches first
  const topic = findTopicKey(qnorm);
  const ent = findEntityKey(qnorm);
  const results = [];
  if(topic) results.push({ id: `topic:${topic}`, title: titleCase(topic), text: KB.topics[topic], score: 999 });
  if(ent) {
    const e = KB.entities[ent];
    const blurb = Object.entries(e).filter(([k])=>k!=='type').slice(0,4).map(([k,v])=>`${titleCase(k)}: ${v}`).join("; ");
    results.push({ id: `entity:${ent}`, title: titleCase(ent), text: blurb, score: 998 });
  }

  // 2) search IndexedDB for chunk matches (if IDB exists)
  try{
    await openIDB();
    // get postings for query terms
    const qterms = Array.from(new Set(tokenize(qnorm)));
    const postingLists = await Promise.all(qterms.map(t => idbGetPosting(t)));
    // merge scores by idf heuristic
    const counts = {}; // id -> score
    let totalChunks = await idbCount('chunks').catch(()=>1000);
    postingLists.forEach((p, idx) => {
      if(!p) return;
      const idf = Math.log(1 + (totalChunks / Math.max(1, p.postings.length)));
      p.postings.forEach(id => {
        counts[id] = (counts[id] || 0) + idf;
      });
    });
    // pick top candidates
    const cand = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0, topK*8).map(x=>x[0]);
    // fetch candidate chunks
    const chunks = await Promise.all(cand.map(id => idbGetChunk(id)));
    // refine score by term overlap
    const qset = new Set(qterms);
    const refined = chunks.filter(Boolean).map(ch => {
      const chTokens = new Set(tokenize(ch.text));
      let overlap = 0;
      for(const t of qset) if(chTokens.has(t)) overlap++;
      const base = counts[ch.id] || 0;
      return { id: ch.id, title: ch.title, text: ch.text, score: base + (overlap / (1 + chTokens.size)) };
    }).sort((a,b)=>b.score - a.score).slice(0, topK);
    results.push(...refined);
  }catch(e){
    // IDB not available or no chunks imported; ignore
  }

  // 3) include builtin entity/topic results and return unique by id (highest score first)
  const unique = {};
  for(const r of results) {
    if(!r) continue;
    if(!unique[r.id] || unique[r.id].score < r.score) unique[r.id] = r;
  }
  const out = Object.values(unique).sort((a,b)=>b.score - a.score).slice(0, topK);
  return out;
}

/* IndexedDB helpers for chunks & postings */
function idbGetPosting(term){
  return new Promise(async (resolve, reject) => {
    try{
      const db = await openIDB();
      const tx = db.transaction('postings','readonly');
      const store = tx.objectStore('postings');
      const req = store.get(term);
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> resolve(null);
    }catch(e){ resolve(null); }
  });
}
function idbGetChunk(id){
  return new Promise(async (resolve, reject) => {
    try{
      const db = await openIDB();
      const tx = db.transaction('chunks','readonly');
      const store = tx.objectStore('chunks');
      const req = store.get(id);
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> resolve(null);
    }catch(e){ resolve(null); }
  });
}
function idbCount(storeName){
  return new Promise(async (resolve, reject) => {
    try{
      const db = await openIDB();
      const tx = db.transaction(storeName,'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    }catch(e){ reject(e); }
  });
}

/* importKBFile: ingest a preprocessed chunks.json (array of {id,title,text}) */
async function importKBFile(file){
  try{
    const text = await file.text();
    const chunks = JSON.parse(text);
    if(!Array.isArray(chunks)) throw new Error('KB file must be array of chunks');
    const db = await openIDB();
    const tx = db.transaction(['chunks','postings','meta'],'readwrite');
    const chunksStore = tx.objectStore('chunks');
    const postingsStore = tx.objectStore('postings');
    for(const ch of chunks){
      chunksStore.put(ch);
      // naive postings: unique tokens
      const terms = Array.from(new Set(tokenize(ch.text)));
      for(const t of terms){
        const getReq = postingsStore.get(t);
        getReq.onsuccess = (ev) => {
          const cur = ev.target.result;
          if(!cur) postingsStore.put({ term: t, postings: [ch.id] });
          else {
            // avoid duplicates
            if(!cur.postings.includes(ch.id)){
              cur.postings.push(ch.id);
              postingsStore.put(cur);
            }
          }
        };
        // ignore error channel for speed
      }
    }
    tx.oncomplete = ()=> {
      alert(`KB import completed: ${chunks.length} chunks added.`);
    };
    tx.onerror = ()=> {
      console.warn('Import TX error', tx.error);
      alert('KB import failed (see console).');
    };
  }catch(e){
    console.error(e);
    alert('Failed to import KB: ' + e.message);
  }
}

/* ===================== Synthesis: create a human-like answer from retrieved chunks ===================== */
function synthesizeAnswer(query, retrieved){
  // Choose sentences from top chunks containing most query terms
  const qterms = new Set(tokenize(normalize(query)));
  const sentences = [];
  for(const r of retrieved){
    // split into sentences
    const sents = r.text.split(/(?<=[.?!])\s+/).filter(Boolean);
    // pick best sentence from chunk
    let best = null, bestScore = -1;
    for(const s of sents){
      const toks = new Set(tokenize(s));
      let overlap = 0;
      qterms.forEach(t => { if(toks.has(t)) overlap++; });
      const score = overlap + (toks.size <= 20 ? 0.1 : 0);
      if(score > bestScore){ bestScore = score; best = s; }
    }
    if(best) sentences.push({ text: best.trim(), source: r.title || r.id, score: bestScore + (r.score || 0) });
  }
  // fallback: if no sentence selected, just use the top chunk text (truncated)
  if(sentences.length === 0 && retrieved.length > 0){
    sentences.push({ text: retrieved[0].text.split(/\n/).slice(0,2).join(' '), source: retrieved[0].title || retrieved[0].id, score: retrieved[0].score || 0 });
  }
  // build answer
  if(sentences.length === 0) return "I couldn't find something clear in my library. Want to teach me or import more knowledge?";
  // sort highest score first and combine up to 2 sentences
  sentences.sort((a,b)=>b.score - a.score);
  const chosen = sentences.slice(0,2).map(s=>s.text);
  let answer = chosen.join(' ');
  // optionally cite the top source
  const cite = sentences[0].source ? ` (source: ${sentences[0].source})` : '';
  return answer + cite;
}

/* ===================== Import/Export handlers (memory & knowledge) ===================== */
function downloadJSON(filename, obj){
  const blob = new Blob([JSON.stringify(obj,null,2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ===================== UI: Bot speak and user input handling ===================== */
async function botSay(text){
  setTyping(true);
  // simulate typing latency proportional to length (but clamp)
  const ms = clamp(300 + text.length * 8, 400, 1800);
  await sleep(ms);
  addMessage('bot', text);
  setTyping(false);
}

/* handle user input */
async function handleUserInput(e){
  e.preventDefault();
  const raw = inputEl.value.trim();
  if(!raw) return;
  addMessage('user', raw);
  inputEl.value = '';
  MEMORY.seen = (MEMORY.seen || 0) + 1;
  MEMORY.lastSeen = new Date().toISOString();
  saveJSON(STORE.MEM, MEMORY);

  // quick local teach handler first (fast)
  const teachReply = clientTeach(raw);
  if(teachReply){ await botSay(ARU.respondStyle(teachReply)); return; }

  // process via brain
  const reply = await brain(raw);
  await botSay(reply);
}

/* local quick teach rules (client-side immediate) */
function clientTeach(text){
  const t = normalize(text);
  let m;
  if(m = t.match(/\bmy\s+name\s+is\s+([\w\-\s']+)/i)){
    const nm = titleCase(m[1].trim());
    MEMORY.user.name = nm;
    saveJSON(STORE.MEM, MEMORY);
    return `Nice to meet you, ${nm}. I will remember that.`;
  }
  if(m = t.match(/\bremember\s+that\s+(.+?)\s+is\s+(.+)\b/i)){
    const subj = m[1].trim();
    const val = m[2].trim();
    saveMemoryEntry(subj, 'is', val);
    return `Saved: ${titleCase(subj)} is ${val}.`;
  }
  // pattern: "X is Y" can teach too but to avoid noise only accept reasonably short subjects
  if(m = t.match(/\b(.{1,40}?)\s+is\s+(.{1,200})\b/i)){
    const subj = m[1].trim();
    const val = m[2].trim();
    // ensure it's not an obvious question
    if(!subj.includes('what') && subj.split(/\s+/).length < 6){
      saveMemoryEntry(subj, 'is', val);
      return `Noted: ${titleCase(subj)} is ${val}.`;
    }
  }
  return null;
}

/* ===================== Wiring UI Elements ===================== */
formEl.addEventListener('submit', handleUserInput);

personaEl.addEventListener('change', ()=>{
  PREFS.personality = personaEl.value;
  saveJSON(STORE.PREFS, PREFS);
});

btnExportMem.addEventListener('click', ()=> downloadJSON('aru-memory.json', MEMORY));
btnImportMem.addEventListener('click', ()=> fileImportMem.click());
fileImportMem.addEventListener('change', ()=> {
  const f = fileImportMem.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ()=>{ try {
      MEMORY = JSON.parse(r.result);
      saveJSON(STORE.MEM, MEMORY);
      botSay('Memory imported successfully.');
    } catch {
      botSay('Import failed: invalid JSON.');
    }
  };
  r.readAsText(f);
});

btnExportKnow.addEventListener('click', ()=> downloadJSON('aru-knowledge.json', KB));
btnImportKnow.addEventListener('click', ()=> fileImportKnow.click());
fileImportKnow.addEventListener('change', ()=> {
  const f = fileImportKnow.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = async ()=> {
    try {
      const obj = JSON.parse(r.result);
      // If it's chunk array for IDB import, call importKBFile
      if(Array.isArray(obj) && obj.length && obj[0].id && obj[0].text){
        await importKBFile(f);
      } else {
        // assume it's a KB object to replace builtin (entities, topics, patterns)
        KB = obj;
        saveJSON(STORE.KB_CUSTOM, KB);
        botSay('Knowledge imported. I updated my library.');
      }
    } catch(e){
      botSay('Import failed: invalid JSON.');
    }
  };
  r.readAsText(f);
});

btnReset.addEventListener('click', ()=>{
  if(confirm('Clear chat, memory, and custom knowledge?')){
    resetAll();
    messagesEl.innerHTML = '';
    addMessage('bot', 'Memory cleared. Back to defaults.');
  }
});

btnAbout.addEventListener('click', ()=> {
  botSay(`${ARU.intro} I save facts you teach me, and you can import large knowledge packs. Memory entries record a precise timestamp when saved.`);
});

/* Reset to defaults (clear localStorage and IDB stores) */
async function resetAll(){
  localStorage.removeItem(STORE.MEM);
  localStorage.removeItem(STORE.PREFS);
  localStorage.removeItem(STORE.KB_CUSTOM);
  MEMORY = { user:{name:null}, facts:{}, seen:0, lastSeen:null, history:[] };
  PREFS = { personality:'friendly' };
  KB = JSON.parse(JSON.stringify(BUILTIN_KB));
  // clear IDB stores
  try{
    const db = await openIDB();
    const tx = db.transaction(['chunks','postings','memory'],'readwrite');
    tx.objectStore('chunks').clear();
    tx.objectStore('postings').clear();
    tx.objectStore('memory').clear();
  }catch(e){}
}

/* ===================== Boot greeting ===================== */
async function greet(){
  PREFS = loadJSON(STORE.PREFS) || PREFS;
  personaEl.value = PREFS.personality || 'friendly';
  // load custom KB if present
  const custom = loadJSON(STORE.KB_CUSTOM);
  if(custom) KB = custom;
  const first = (MEMORY.seen || 0) === 0;
  if(first){
    await botSay(`Hi — I'm ${ARU.name}. ${ARU.intro} Ask me things like "capital of Japan", "who is Einstein", or teach me: "remember that my favorite food is pizza". You can import knowledge packs (chunks.json) to expand me.`);
  } else {
    await botSay(`Welcome back${MEMORY.user.name ? ', '+MEMORY.user.name : ''}! I'm ready — ask me anything.`);
  }
}
greet();

/* ===================== Helper: findTopicKey helper used earlier ===================== */
function guessSubject(text){
  const words = tokenize(text).filter(w=>w.length>2);
  return words.slice(-1)[0] || "it";
}

/* ===================== End of script ================================== */

/* ===================== USAGE NOTES & HOW TO EXPAND =====================
- This file is intentionally self-contained and runs entirely in the browser.
- To expand Aru's knowledge:
   1) Produce chunk JSON via preprocessor (node script provided earlier in instructions).
   2) In the UI, choose "Import Knowledge" and select your chunks JSON file — it will be ingested into IndexedDB.
- Memory writes:
   - Each time Aru learns (via "remember that X is Y" or "my name is ..."), we save to localStorage and put an IDB memory record with a precise timestamp (performance + epoch).
   - Browsers do not allow continuous writes at 0.1 ms intervals; however each saved memory records a fractional-millisecond timestamp so you have high-precision time of the save.
- Slang handling is in SLANG; extend it by editing the SLANG object.
- If you want additional "smarts" (paraphrase matching), add the MinHash / LSH preprocessor and signatures to chunk metadata (I can provide that next).
- If you want Aru to sound smarter, add more KB chunks and expand KB.topics/entities/patterns.
====================================================================== */

