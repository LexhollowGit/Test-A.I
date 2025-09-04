// ===========================
// Browser Brain (No API/Model)
// ===========================
//
// Everything here is YOUR code: lightweight NLP, knowledge base, memory,
// personality, and a simple reasoning/reply engine. Runs 100% in the browser.
//

/* ---------- DOM ---------- */
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

/* ---------- Utilities ---------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString();
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));

/* ---------- Tiny Text Ops (normalize/tokenize/stem) ---------- */
function normalize(text) {
  return text.toLowerCase().replace(/[“”‘’]/g,'"').replace(/[^\w\s\-\'\?\.!]/g," ").replace(/\s+/g," ").trim();
}
function tokenize(text) {
  return normalize(text).split(/\s+/);
}
// super tiny stemmer (just trims common suffixes)
function stem(word) {
  return word
    .replace(/(ing|ed|ly|ness|ment|ers|er|s)$/,'')
    .replace(/ies$/,'y');
}
function bagOfWords(tokens){ const m=new Map(); tokens.forEach(t=>m.set(t,(m.get(t)||0)+1)); return m; }

/* ---------- Synonyms & Aliases ---------- */
const SYN = {
  hello:["hi","hey","yo","sup","hiya","hullo","hello"],
  bye:["goodbye","bye","cya","see ya","farewell","later"],
  thanks:["thanks","thank","ty","tysm","thankyou","appreciate"],
  name:["name","call","called","who are you"],
  capital:["capital","capitol","main city","metropolis","city"],
  weather:["weather","climate","temperature"],
  time:["time","clock","date","day"],
};

/* ---------- Levenshtein (for fuzzy lookup) ---------- */
function levenshtein(a,b){
  const m = Array.from({length:a.length+1},(_,i)=>[i]);
  for(let j=1;j<=b.length;j++) m[0][j]=j;
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+cost);
    }
  }
  return m[a.length][b.length];
}
function isClose(a,b,threshold=2){ return levenshtein(a,b) <= threshold; }

/* ---------- Knowledge Base (You can expand this) ---------- */
let KNOWLEDGE = {
  // Entities with properties (facts)
  entities:{
    japan: { type:"country", capital:"Tokyo", population:"~125 million", language:"Japanese", region:"Asia" },
    philippines: { type:"country", capital:"Manila", population:"~114 million", language:"Filipino, English", region:"Southeast Asia" },
    earth: { type:"planet", age:"~4.54 billion years", orbit:"Sun", position:"Solar System" },
    sun: { type:"star", type2:"G-type main-sequence", distance:"1 AU from Earth (average)" },
    einstein: { type:"person", name:"Albert Einstein", born:"1879", field:"physics", known:"theory of relativity" },
    newton: { type:"person", name:"Isaac Newton", born:"1643", field:"physics", known:"laws of motion & gravity" },
    water: { type:"compound", formula:"H2O", state:"liquid (room temp)", boiling:"100°C", freezing:"0°C" },
    moon: { type:"moon", orbits:"Earth", distance:"~384,400 km", period:"~27.3 days" }
  },
  // Topic blurbs: short summaries generator can stitch into answers
  topics:{
    "ai":"Artificial intelligence is a field of computer science focused on making machines perform tasks that typically require human intelligence: perception, reasoning, learning, and action.",
    "photosynthesis":"Photosynthesis is how plants convert light energy into chemical energy, producing glucose and oxygen from carbon dioxide and water.",
    "gravity":"Gravity is the attractive force between masses; on Earth it accelerates objects downward at about 9.81 m/s².",
    "internet":"The internet is a global network of interconnected computers that use standardized protocols to communicate data."
  },
  // Pattern facts (flexible Q&A)
  patterns:[
    { q:/\b(capital|capital of)\b\s+(?<country>\w[\w\s\-]+)\??/i,
      a: ({country}) => {
        const key = findEntityKey(country);
        if(!key) return null;
        const e = KNOWLEDGE.entities[key];
        return e.capital ? `The capital of ${title(key)} is ${e.capital}.` : null;
      }
    },
    { q:/\bwho\s+is\s+(?<person>[\w\s\-]+)\??/i,
      a: ({person}) => {
        const key = findEntityKey(person);
        const e = key && KNOWLEDGE.entities[key];
        if(e && e.type==="person"){
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
    { q:/\bwhat\s+is\s+(?<thing>[\w\s\-]+)\??/i,
      a: ({thing}) => {
        const tkey = findTopicKey(thing);
        if(tkey) return KNOWLEDGE.topics[tkey];
        const ekey = findEntityKey(thing);
        if(ekey){
          const e = KNOWLEDGE.entities[ekey];
          const blurb = Object.entries(e).filter(([k])=>k!=="type").slice(0,3).map(([k,v])=>`${title(k)}: ${v}`).join("; ");
          return `${title(ekey)} — ${blurb}.`;
        }
        return null;
      }
    }
  ]
};

/* ---------- Memory (persists across sessions) ---------- */
const STORE_KEYS = {
  mem: 'bb_memory_v1',
  prefs: 'bb_prefs_v1',
  know: 'bb_knowledge_v1' // optional override if user imports knowledge
};

let MEMORY = loadJSON(STORE_KEYS.mem) || {
  user: { name: null, favorites: {} },
  facts: {},          // free-form: { topic: { prop: value } }
  seen: 0,            // number of exchanges
  lastSeen: null
};

let PREFS = loadJSON(STORE_KEYS.prefs) || {
  personality: 'friendly',
};

const userName = ()=> MEMORY.user.name || "friend";

/* ---------- Persistence helpers ---------- */
function saveJSON(key, obj){ localStorage.setItem(key, JSON.stringify(obj)); }
function loadJSON(key){ try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function resetAll(){
  localStorage.removeItem(STORE_KEYS.mem);
  localStorage.removeItem(STORE_KEYS.prefs);
  localStorage.removeItem(STORE_KEYS.know);
  MEMORY = { user:{name:null,favorites:{}}, facts:{}, seen:0, lastSeen:null };
  PREFS = { personality:'friendly' };
  // restore built-in knowledge if user imported a custom one
  KNOWLEDGE = { ...BUILTIN_KNOWLEDGE_BACKUP() };
}

/* Keep a pristine copy of built-in knowledge for reset */
function BUILTIN_KNOWLEDGE_BACKUP(){ return JSON.parse(JSON.stringify(KNOWLEDGE)); }
const BUILTIN_KNOW = BUILTIN_KNOWLEDGE_BACKUP();

/* Apply user-imported knowledge if any */
const imported = loadJSON(STORE_KEYS.know);
if(imported){ KNOWLEDGE = imported; }

/* ---------- Message UI ---------- */
function addMessage(role, text){
  const li = document.createElement('li');
  li.className = `msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${role === 'user' ? 'You' : 'Bot'} • ${now()}`;
  li.appendChild(bubble);
  li.appendChild(meta);
  messagesEl.appendChild(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function setTyping(v){ typingEl.classList.toggle('hidden', !v); }

/* ---------- Personalities ---------- */
const PERSONALITIES = {
  neutral: (s)=>s,
  friendly: (s)=> rand([
    s, s, `🙂 ${s}`, `${s} Thanks for asking!`, `${s} Anything else you’re curious about?`
  ]),
  playful: (s)=> rand([`Fun fact: ${s}`, `${s} 🐣`, `Okay, brain says: ${s}`, `✨ ${s}`]),
  dry: (s)=> rand([s, s, `Answer: ${s}`, `.${s}.`]),
};

function respondStyle(s){ const f = PERSONALITIES[PREFS.personality] || PERSONALITIES.neutral; return f(s); }

/* ---------- Intent detection ---------- */
const INTENTS = [
  { name:'greeting', test:(t)=> hasAny(t,SYN.hello) },
  { name:'farewell', test:(t)=> hasAny(t,SYN.bye) },
  { name:'thanks',   test:(t)=> hasAny(t,SYN.thanks) },
  { name:'ask_time', test:(t)=> /\b(time|date|day)\b/.test(t) && /\bwhat\b/.test(t) },
  { name:'ask_name', test:(t)=> /\b(your|bot).*(name)|who\s+are\s+you/.test(t) },
  { name:'teach_is', test:(t)=> /\bremember\b.+\bthat\b.+\bis\b.+/.test(t) || /\b(.+)\s+is\s+(.+)\b/.test(t) },
  { name:'tell_name',test:(t)=> /\bmy\s+name\s+is\s+([\w\-\'\s]+)\b/.test(t) },
];

/* ---------- Core brain: route input ---------- */
async function brain(userRaw){
  const text = normalize(userRaw);
  const tokens = tokenize(userRaw).map(stem);
  const bow = bagOfWords(tokens);

  // 1) Fast intents
  for(const intent of INTENTS){
    if(intent.test(text)){
      const out = handleIntent(intent.name, text);
      if(out) return out;
    }
  }

  // 2) Pattern rules in knowledge
  for(const rule of KNOWLEDGE.patterns){
    const m = text.match(rule.q);
    if(m){
      const result = rule.a(m.groups || {});
      if(result) return result;
    }
  }

  // 3) Knowledge entity/property probing like: "capital of japan", "einstein born"
  const propQ = extractPropQuery(text);
  if(propQ){
    const { entityGuess, propGuess } = propQ;
    const ekey = findEntityKey(entityGuess);
    if(ekey){
      const val = lookupProp(KNOWLEDGE.entities[ekey], propGuess);
      if(val) return `${title(ekey)} — ${title(propGuess)}: ${val}.`;
    }
  }

  // 4) Small talk / topic summaries
  const tkey = findTopicKey(text);
  if(tkey) return KNOWLEDGE.topics[tkey];

  // 5) Memory-based answers
  const memAns = memoryAnswer(text);
  if(memAns) return memAns;

  // 6) Askback + learning hook
  return askToTeach(text);
}

/* ---------- Intent handlers ---------- */
function handleIntent(name, text){
  if(name==='greeting') return respondStyle(rand([
    `Hello ${userName()}!`, `Hey ${userName()}!`, `Hi there!`
  ]));
  if(name==='farewell') return respondStyle(rand([
    `Goodbye!`, `See you later!`, `Take care, ${userName()}!`
  ]));
  if(name==='thanks') return respondStyle(rand([
    `You’re welcome!`, `Anytime.`, `Happy to help.`
  ]));
  if(name==='ask_time'){
    const d = new Date();
    return respondStyle(`It’s ${d.toLocaleTimeString()} on ${d.toLocaleDateString()}.`);
  }
  if(name==='ask_name'){
    return respondStyle(`I’m Browser Brain — a no-API chatbot living in your browser.`);
  }
  if(name==='tell_name'){
    const m = text.match(/\bmy\s+name\s+is\s+([\w\-\'\s]+)\b/);
    if(m){ MEMORY.user.name = title(m[1].trim()); saveJSON(STORE_KEYS.mem, MEMORY); }
    return respondStyle(`Nice to meet you, ${userName()}! I’ll remember that.`);
  }
  if(name==='teach_is'){
    // Formats: "remember that X is Y" OR "X is Y"
    let m = text.match(/\bremember\s+that\s+(.+?)\s+is\s+(.+)\b/);
    if(!m) m = text.match(/\b(.+?)\s+is\s+(.+)\b/);
    if(m){
      const subj = m[1].trim();
      const pred = m[2].trim();
      learnFact(subj, 'is', pred);
      return respondStyle(`Got it: ${title(subj)} is ${pred}. I’ve saved that to memory.`);
    }
  }
  return null;
}

/* ---------- Knowledge lookups ---------- */
function title(s){ return s.replace(/\b\w/g,c=>c.toUpperCase()); }
function hasAny(text, words){ return words.some(w=> new RegExp(`\\b${w}\\b`,'i').test(text)); }

function findEntityKey(query){
  const q = normalize(query).replace(/\?$/,'');
  const keys = Object.keys(KNOWLEDGE.entities);
  // Exact
  let hit = keys.find(k=>k===q);
  if(hit) return hit;
  // Includes / alias
  hit = keys.find(k=> q.includes(k) || k.includes(q));
  if(hit) return hit;
  // Fuzzy
  let best = null, bestD = Infinity;
  for(const k of keys){
    const d = levenshtein(q,k);
    if(d<bestD){ bestD=d; best=k; }
  }
  return bestD<=2 ? best : null;
}

function findTopicKey(query){
  const q = normalize(query);
  const keys = Object.keys(KNOWLEDGE.topics);
  return keys.find(k=> q.includes(k)) || keys.find(k=> isClose(k, q)) || null;
}

function lookupProp(obj, propQ){
  const keys = Object.keys(obj);
  // direct
  if(obj[propQ] != null) return obj[propQ];
  // fuzzy
  let best=null, bestD=Infinity;
  for(const k of keys){
    const d = levenshtein(propQ, k);
    if(d<bestD){ bestD=d; best=k; }
  }
  return bestD<=2 ? obj[best] : null;
}

function extractPropQuery(text){
  // Try formats like "einstein born", "water boiling point", "capital japan"
  const words = tokenize(text);
  if(words.length<2) return null;
  // heuristic: last word(s) are entity, first word(s) are property
  const candidates = [];
  for(let split=1; split<words.length; split++){
    const propGuess = words.slice(0,split).join(' ');
    const entityGuess = words.slice(split).join(' ');
    candidates.push({propGuess, entityGuess});
  }
  // rate candidates by entity closeness
  let best=null, score=-Infinity;
  for(const c of candidates){
    const ekey = findEntityKey(c.entityGuess);
    if(!ekey) continue;
    const s = c.propGuess.length; // crude
    if(s > score){ score=s; best=c; }
  }
  return best;
}

/* ---------- Memory system ---------- */
function learnFact(subject, prop, value){
  const key = normalize(subject);
  MEMORY.facts[key] = MEMORY.facts[key] || {};
  MEMORY.facts[key][prop] = value;
  saveJSON(STORE_KEYS.mem, MEMORY);
}
function memoryAnswer(text){
  // If user asks: "who am i", "what's my name", "what did i tell you"
  if(/\b(who\s+am\s+i|what(\'s| is)\s+my\s+name)\b/.test(text)){
    if(MEMORY.user.name) return `You said your name is ${MEMORY.user.name}.`;
    return `I don’t know your name yet. Tell me by saying “my name is …”.`;
  }
  // If user asks about a subject we've stored
  const keys = Object.keys(MEMORY.facts);
  for(const k of keys){
    if(text.includes(k)){
      const props = MEMORY.facts[k];
      const firstProp = Object.keys(props)[0];
      if(firstProp) return `${title(k)} — ${title(firstProp)}: ${props[firstProp]}.`;
    }
  }
  return null;
}

/* ---------- Askback when unknown ---------- */
function askToTeach(text){
  const prompts = [
    `I’m not sure about that yet. Want to teach me? Use “remember that X is Y”.`,
    `That one’s new to me. You can say “remember that ${guessSubject(text)} is …”.`,
    `I don’t know that. If you tell me, I’ll remember for next time.`,
  ];
  return respondStyle(rand(prompts));
}
function guessSubject(text){
  const words = tokenize(text).filter(w=>w.length>2);
  return words.slice(-1)[0] || "it";
}

/* ---------- Import / Export ---------- */
function downloadJSON(filename, obj){
  const blob = new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- Wire up UI ---------- */
async function botSay(text){
  setTyping(true);
  await sleep(clamp(300 + text.length*12, 400, 1800));
  addMessage('bot', text);
  setTyping(false);
}

async function handleUserInput(e){
  e.preventDefault();
  const raw = inputEl.value.trim();
  if(!raw) return;
  addMessage('user', raw);
  inputEl.value = '';
  MEMORY.seen += 1;
  MEMORY.lastSeen = new Date().toISOString();
  saveJSON(STORE_KEYS.mem, MEMORY);

  const reply = await brain(raw);
  await botSay(reply);
}

formEl.addEventListener('submit', handleUserInput);

personaEl.addEventListener('change', ()=>{
  PREFS.personality = personaEl.value;
  saveJSON(STORE_KEYS.prefs, PREFS);
});

btnExportMem.addEventListener('click', ()=> downloadJSON('browser-brain-memory.json', MEMORY));
btnImportMem.addEventListener('click', ()=> fileImportMem.click());
fileImportMem.addEventListener('change', ()=> {
  const f = fileImportMem.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ()=>{ try{
      MEMORY = JSON.parse(r.result);
      saveJSON(STORE_KEYS.mem, MEMORY);
      botSay('Memory imported successfully.');
    }catch{ botSay('Import failed: invalid JSON.'); }
  };
  r.readAsText(f);
});

btnExportKnow.addEventListener('click', ()=> {
  downloadJSON('browser-brain-knowledge.json', KNOWLEDGE);
});
btnImportKnow.addEventListener('click', ()=> fileImportKnow.click());
fileImportKnow.addEventListener('change', ()=>{
  const f = fileImportKnow.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ()=>{ try{
      const obj = JSON.parse(r.result);
      KNOWLEDGE = obj;
      saveJSON(STORE_KEYS.know, KNOWLEDGE);
      botSay('Knowledge imported. My library just got bigger!');
    }catch{ botSay('Import failed: invalid JSON.'); }
  };
  r.readAsText(f);
});

btnReset.addEventListener('click', ()=>{
  if(confirm('Clear chat, memory, and custom knowledge?')) {
    resetAll();
    messagesEl.innerHTML = '';
    addMessage('bot','Memory cleared. Back to defaults.');
  }
});

btnAbout.addEventListener('click', ()=>{
  botSay('I am a no-API, no-model chatbot. I answer using rules, fuzzy matching, a built-in knowledge base, and memory you can teach me. Everything runs locally.');
});

/* ---------- Boot greeting ---------- */
function greet(){
  PREFS = loadJSON(STORE_KEYS.prefs) || PREFS;
  personaEl.value = PREFS.personality || 'friendly';

  const first = MEMORY.seen===0;
  if(first){
    botSay(`Hi! I’m Browser Brain. I don’t use any APIs or models — just code. Ask me things like “capital of Japan”, “who is Einstein”, or teach me: “remember that my name is Lex”.`);
  }else{
    botSay(`Welcome back${MEMORY.user.name?`, ${MEMORY.user.name}`:''}! Ask me anything or teach me new facts.`);
  }
}
greet();
