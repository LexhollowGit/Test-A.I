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
  // replace common typos / short forms
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

// 🟢 Random fallback responses
function randomFallback(input) {
  const options = [
    `Hmm, "${input}" sounds interesting. Maybe it’s something scientific or historic.`,
    `I don’t have exact info on "${input}", but it seems important.`,
    `That’s unexpected! "${input}" might need more research.`,
    `I don’t know everything yet, but "${input}" sounds fascinating.`,
    `Good question about "${input}". You could teach me!`
  ];
  return options[Math.floor(Math.random() * options.length)];
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
  return randomFallback(userInput);
}

// === UI Hook ===
document.addEventListener("DOMContentLoaded", () => {
  loadKnowledge();

  const input = document.getElementById("userInput");
  const chat = document.getElementById("chat");

  document.getElementById("sendBtn").addEventListener("click", () => {
    let userText = input.value.trim();
    if (!userText) return;

    // User message
    chat.innerHTML += `<div><b>You:</b> ${userText}</div>`;

    // Aru reply
    let reply = think(userText);
    chat.innerHTML += `<div><b>Aru:</b> ${reply}</div>`;

    input.value = "";
    chat.scrollTop = chat.scrollHeight;
  });
});
