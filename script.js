// === Aru: AI Chatbot Brain ===
// Extended to support modular packs + smarter understanding

let knowledge = {}; // all packs stored here
let memory = []; // conversation memory

// 🟢 Load multiple packs at startup
async function loadKnowledge() {
  const packs = ["core.json", "science.json", "history.json", "slang.json", "math.json"];
  for (let pack of packs) {
    try {
      const response = await fetch(pack);
      const data = await response.json();
      knowledge[pack.replace(".json", "")] = data;
      console.log(`✅ Loaded ${pack}`);
    } catch (e) {
      console.warn(`⚠️ Could not load ${pack}`, e);
    }
  }
}

// 🟢 Normalize input (case, grammar, symbols)
function normalizeInput(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s\+\-\*\/\^\.]/g, "")
    .trim();
}

// 🟢 Expand slang (from slang.json)
function expandSlang(text) {
  if (!knowledge.slang) return text;
  let words = text.split(" ");
  return words.map(w => knowledge.slang[w] || w).join(" ");
}

// 🟢 Fix simple grammar (heuristic)
function grammarFix(text) {
  const fixes = {
    "whn": "when",
    "wat": "what",
    "wht": "what",
    "r": "are",
    "u": "you",
    "ur": "your",
    "pls": "please",
    "plz": "please",
    "idk": "i don’t know"
  };
  return text.split(" ").map(w => fixes[w] || w).join(" ");
}

// 🟢 Detect & solve math
function solveMath(text) {
  try {
    if (/[\d\+\-\*\/\^]/.test(text)) {
      let expr = text.replace("^", "**"); // support power
      let result = Function('"use strict";return (' + expr + ")")();
      if (!isNaN(result)) return `${expr} = ${result}`;
    }
  } catch {
    return null;
  }
  return null;
}

// 🟢 Search knowledge packs
function searchKnowledge(text) {
  for (let category in knowledge) {
    for (let key in knowledge[category]) {
      if (text.includes(key)) {
        return knowledge[category][key];
      }
    }
  }
  return null;
}

// 🟢 Smart fallback generator
const SMART_TEMPLATES = {
  when: [
    "I think it was around {year}.",
    "Probably back in {year}.",
    "Historical records suggest {year}."
  ],
  where: [
    "Most sources say {place}.",
    "It seems to originate from {place}.",
    "People often associate it with {place}."
  ],
  why: [
    "Well, it's probably because {reason}.",
    "I’d guess it’s due to {reason}.",
    "Seems like {reason} is the main reason."
  ],
  what: [
    "It's basically {description}.",
    "You could think of it as {description}.",
    "People describe it as {description}."
  ],
  how: [
    "Usually, it's done by {method}.",
    "You can try {method}.",
    "It involves {method} in general."
  ]
};

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSmartAnswer(input) {
  const n = normalizeInput(input);
  let type = null;

  if(/\bwhen\b/.test(n)) type = 'when';
  else if(/\bwhere\b/.test(n)) type = 'where';
  else if(/\bwhy\b/.test(n)) type = 'why';
  else if(/\bwhat\b/.test(n)) type = 'what';
  else if(/\bhow\b/.test(n)) type = 'how';

  const tmplList = SMART_TEMPLATES[type] || Object.values(SMART_TEMPLATES).flat();
  const template = rand(tmplList);

  const placeholders = {
    year: `${1800 + Math.floor(Math.random() * 220)} AD`,
    place: rand(['China', 'Italy', 'Egypt', 'Europe', 'Middle East', 'America', 'India']),
    reason: rand(['historical reasons', 'natural causes', 'scientific factors', 'cultural habits']),
    description: rand(['a type of object', 'an idea', 'a concept', 'a practice', 'a phenomenon']),
    method: rand(['a standard process', 'common techniques', 'usual steps', 'typical methods'])
  };

  return template.replace(/\{(\w+)\}/g, (_, key) => placeholders[key] || 'something');
}

// 🟢 Main brain
function think(userInput) {
  memory.push({ user: userInput });

  let text = normalizeInput(userInput);
  text = expandSlang(text);
  text = grammarFix(text);

  // 1. Try math
  let mathAnswer = solveMath(text);
  if (mathAnswer) return mathAnswer;

  // 2. Try knowledge packs
  let fact = searchKnowledge(text);
  if (fact) return fact;

  // 3. Fallback smart guess
  return generateSmartAnswer(userInput);
}

// === UI Hook ===
document.addEventListener("DOMContentLoaded", () => {
  loadKnowledge();

  const input = document.getElementById("userInput");
  const chat = document.getElementById("chat");

  document.getElementById("sendBtn").addEventListener("click", () => {
    let userText = input.value.trim();
    if (!userText) return;

    chat.innerHTML += `<div><b>You:</b> ${userText}</div>`;
    let reply = think(userText);
    chat.innerHTML += `<div><b>Aru:</b> ${reply}</div>`;

    input.value = "";
    chat.scrollTop = chat.scrollHeight;
  });
});
