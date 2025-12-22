// ============= CONFIG =============

// Mercury Parser community endpoint
const MERCURY_ENDPOINT = "https://mercury-parser.vercel.app/api?url=";

// FreeDictionaryAPI endpoint
const DICT_ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en/";

// Very common English words to ignore for simple English layer (Option D)
const COMMON_WORDS = new Set([
  "the","a","an","and","or","but","if","then","than","when","while","of","in",
  "on","for","to","from","by","with","at","as","is","are","was","were","be",
  "been","being","this","that","these","those","it","its","they","them","their",
  "he","she","his","her","we","us","our","you","your","i","me","my",
  "can","could","will","would","shall","should","may","might","do","does","did",
  "have","has","had","not","no","yes","so","such","just","very","more","most",
  "some","any","all","many","few","much","there","here","also","only","over",
  "into","out","up","down","about","through","between","within","without",
  "new","high","low","large","small","big","little","long","short","old","young",
  "use","make","made","say","says","said","show","shows","shown","get","got"
]);

// Stopwords (can share with COMMON_WORDS; kept separate for clarity)
const STOP_WORDS = COMMON_WORDS;

// Simple name heuristic: capitalized word not at sentence start + appears rarely
// (kept minimal to avoid false positives; you can refine)

// ============= SCIENTIFIC DICTIONARIES (stubs to expand) =============

const dictMicro = {
  pathogen: "A microorganism (such as a bacterium or virus) that can cause disease.",
  virulence: "The degree of pathogenicity of a microorganism.",
  biofilm: "A structured community of microorganisms encapsulated within a self-produced polymeric matrix."
};

const dictGenetics = {
  genome: "The complete set of DNA, including all of its genes, in an organism.",
  allele: "One of two or more versions of a gene.",
  mutation: "A permanent change in the DNA sequence of a gene.",
};

const dictImmunology = {
  antigen: "A molecule capable of being recognized by the immune system.",
  antibody: "A protein produced by B cells that binds to a specific antigen.",
  cytokine: "A small protein important in cell signaling in the immune system."
};

const dictBiology = {
  homeostasis: "The tendency of an organism to maintain internal stability.",
  metabolism: "The chemical processes that occur within a living organism to maintain life.",
  osmosis: "The diffusion of water across a semipermeable membrane."
};

const dictChemistry = {
  molarity: "A measure of the concentration of a solute in a solution, expressed as moles per liter.",
  catalyst: "A substance that increases the rate of a chemical reaction without being consumed.",
  polymer: "A large molecule composed of repeating structural units."
};

// Combine for "combined" mode
const dictCombined = {
  ...dictMicro,
  ...dictGenetics,
  ...dictImmunology,
  ...dictBiology,
  ...dictChemistry
};

const SCI_DICTIONARIES = {
  micro: dictMicro,
  genetics: dictGenetics,
  immunology: dictImmunology,
  biology: dictBiology,
  chemistry: dictChemistry,
  combined: dictCombined
};

// ============= CACHES =============

const englishDefinitionCache = new Map();   // word -> { definition, source }
const scientificTermCache = new Map();      // word -> { definition, source }

// ============= DOM REFERENCES =============

const articleUrlInput = document.getElementById("articleUrl");
const fetchArticleBtn = document.getElementById("fetchArticleBtn");
const dictionaryModeSelect = document.getElementById("dictionaryMode");
const toggleScientific = document.getElementById("toggleScientific");
const toggleSimpleEnglish = document.getElementById("toggleSimpleEnglish");

const statusMessageEl = document.getElementById("statusMessage");
const articleTitleEl = document.getElementById("articleTitle");
const articleMetaEl = document.getElementById("articleMeta");
const articleContentEl = document.getElementById("articleContent");

const tooltipEl = document.getElementById("tooltip");
const tooltipTermEl = document.getElementById("tooltipTerm");
const tooltipSourceEl = document.getElementById("tooltipSource");
const tooltipDefinitionEl = document.getElementById("tooltipDefinition");

// ============= EVENT BINDINGS =============

fetchArticleBtn.addEventListener("click", () => {
  const url = articleUrlInput.value.trim();
  if (!url) {
    setStatus("Please enter a URL.", "error");
    return;
  }
  fetchAndAnalyzeArticle(url);
});

document.addEventListener("click", (e) => {
  const target = e.target;
  if (target.classList.contains("sci-term") || target.classList.contains("simple-term")) {
    // Term click handled in delegated handler below
    return;
  }
  // Click outside tooltip -> hide
  if (!tooltipEl.contains(e.target)) {
    hideTooltip();
  }
});

articleContentEl.addEventListener("click", async (e) => {
  const target = e.target;
  if (target.classList.contains("sci-term")) {
    const word = target.dataset.term;
    const definition = target.dataset.definition;
    const source = target.dataset.source || "Scientific dictionary";
    showTooltip(word, definition, source, e.pageX, e.pageY);
  } else if (target.classList.contains("simple-term")) {
    const word = target.dataset.term;
    const source = "Simple English dictionary";
    let defObj = englishDefinitionCache.get(word.toLowerCase());
    if (!defObj) {
      // Shouldn't happen often because we populate when building,
      // but we can lazy-fetch as fallback
      defObj = await getSimpleEnglishDefinition(word);
    }
    if (defObj && defObj.definition) {
      showTooltip(word, defObj.definition, source, e.pageX, e.pageY);
    }
  }
});

// ============= STATUS HELPERS =============

function setStatus(message, type = "info") {
  statusMessageEl.textContent = message;
  if (type === "error") {
    statusMessageEl.style.color = "#b00020";
  } else if (type === "success") {
    statusMessageEl.style.color = "#2e7d32";
  } else {
    statusMessageEl.style.color = "#555";
  }
}

// ============= FETCH + ANALYZE =============

async function fetchAndAnalyzeArticle(url) {
  setStatus("Fetching and parsing article…");
  fetchArticleBtn.disabled = true;
  articleTitleEl.textContent = "";
  articleMetaEl.textContent = "";
  articleContentEl.innerHTML = "";
  hideTooltip();

  try {
    const articleData = await getArticleFromMercury(url);
    if (!articleData || !articleData.content) {
      setStatus("Could not extract article content from this URL.", "error");
      fetchArticleBtn.disabled = false;
      return;
    }

    articleTitleEl.textContent = articleData.title || "Untitled article";
    const metaParts = [];
    if (articleData.author) metaParts.push(articleData.author);
    if (articleData.date_published) metaParts.push(new Date(articleData.date_published).toLocaleDateString());
    articleMetaEl.textContent = metaParts.join(" • ");

    const textContent = extractTextFromHtml(articleData.content);
    const processedHtml = await annotateArticleText(textContent);
    articleContentEl.innerHTML = processedHtml;

    setStatus("Article processed successfully.", "success");
  } catch (err) {
    console.error(err);
    setStatus("Error fetching or processing the article.", "error");
  } finally {
    fetchArticleBtn.disabled = false;
  }
}

// ============= MERCURY PARSER =============

async function getArticleFromMercury(url) {
  const encodedUrl = encodeURIComponent(url);
  const endpoint = `${MERCURY_ENDPOINT}${encodedUrl}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    throw new Error("Mercury Parser request failed");
  }
  return res.json();
}

// ============= TEXT EXTRACTION =============

function extractTextFromHtml(htmlString) {
  const tmp = document.createElement("div");
  tmp.innerHTML = htmlString;
  return tmp.textContent || tmp.innerText || "";
}

// ============= TOKENIZATION + ANNOTATION =============

async function annotateArticleText(text) {
  // Simple split preserving punctuation: we’ll rebuild into HTML tokens
  const tokens = text.split(/(\s+|[,.!?;:()"'[\]{}])/);

  const dictMode = dictionaryModeSelect.value;
  const sciDict = SCI_DICTIONARIES[dictMode] || dictCombined;
  const sciKeys = new Set(Object.keys(sciDict).map(k => k.toLowerCase()));

  const annotatedTokens = [];

  for (const token of tokens) {
    // whitespace or punctuation: keep as-is
    if (/^\s+$/.test(token) || /^[,.;:!?()"'[\]{}]$/.test(token)) {
      annotatedTokens.push(token);
      continue;
    }

    const rawWord = token;
    const normalized = normalizeWord(rawWord);

    if (!normalized) {
      annotatedTokens.push(rawWord);
      continue;
    }

    // 1) Scientific layer
    if (toggleScientific.checked && isScientificTerm(normalized, sciKeys)) {
      const def = sciDict[normalized.toLowerCase()];
      const span = createSciTermSpan(rawWord, normalized, def, dictMode);
      annotatedTokens.push(span);
      continue;
    }

    // 2) Stopwords / names (simplified)
    if (isStopWord(normalized) || looksLikeName(rawWord)) {
      annotatedTokens.push(rawWord);
      continue;
    }

    // 3) Simple English layer
    if (toggleSimpleEnglish.checked && shouldTrySimpleEnglish(normalized)) {
      const defObj = await getSimpleEnglishDefinition(normalized);
      if (defObj && defObj.definition) {
        const span = createSimpleTermSpan(rawWord, normalized);
        annotatedTokens.push(span);
        continue;
      }
    }

    // 4) Default: leave as plain text
    annotatedTokens.push(rawWord);
  }

  return annotatedTokens.join("");
}

// ============= SCIENTIFIC TERM HELPERS =============

function normalizeWord(word) {
  return word
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function isScientificTerm(normalizedWord, sciKeys) {
  return sciKeys.has(normalizedWord.toLowerCase());
}

function createSciTermSpan(rawWord, normalized, definition, dictMode) {
  const sourceLabel = modeToSourceLabel(dictMode);
  const escaped = escapeHtml(rawWord);
  const escapedDef = escapeHtml(definition || "No definition available.");
  return `<span class="sci-term" data-term="${normalized}" data-definition="${escapedDef}" data-source="${sourceLabel}">${escaped}</span>`;
}

function modeToSourceLabel(mode) {
  switch (mode) {
    case "micro":
      return "Microbiology glossary";
    case "genetics":
      return "Genetics glossary";
    case "immunology":
      return "Immunology glossary";
    case "biology":
      return "Biology glossary";
    case "chemistry":
      return "Chemistry / Biochemistry glossary";
    default:
      return "Scientific glossary (combined)";
  }
}

// ============= SIMPLE ENGLISH HELPERS =============

function isStopWord(normalizedWord) {
  return STOP_WORDS.has(normalizedWord.toLowerCase());
}

// Very lightweight name heuristic: capitalized word, not at sentence start,
// but here we use a simple check on pattern (you can refine with positions).
function looksLikeName(rawWord) {
  // If it contains a period or is all caps, skip marking as name.
  if (/[.@]/.test(rawWord)) return false;
  if (/^[A-Z][a-z]+$/.test(rawWord)) {
    return true;
  }
  return false;
}

// Option D heuristic for when to try simple English lookup
function shouldTrySimpleEnglish(normalizedWord) {
  const w = normalizedWord.toLowerCase();

  // Ignore very short words (likely not worth defining unless scientific)
  if (w.length <= 3) return false;

  // Ignore very common words
  if (COMMON_WORDS.has(w)) return false;

  return true;
}

async function getSimpleEnglishDefinition(word) {
  const w = word.toLowerCase();

  if (englishDefinitionCache.has(w)) {
    return englishDefinitionCache.get(w);
  }

  try {
    const res = await fetch(DICT_ENDPOINT + encodeURIComponent(w));
    if (!res.ok) {
      englishDefinitionCache.set(w, { definition: null, source: "Simple English dictionary" });
      return englishDefinitionCache.get(w);
    }
    const data = await res.json();
    // data is an array; take first meaning/definition
    const def = extractFirstDefinition(data);
    const defObj = { definition: def, source: "Simple English dictionary" };
    englishDefinitionCache.set(w, defObj);
    return defObj;
  } catch (err) {
    console.error("Dictionary lookup error:", err);
    englishDefinitionCache.set(w, { definition: null, source: "Simple English dictionary" });
    return englishDefinitionCache.get(w);
  }
}

function extractFirstDefinition(apiResponse) {
  if (!Array.isArray(apiResponse) || apiResponse.length === 0) return null;
  const entry = apiResponse[0];
  if (!entry.meanings || entry.meanings.length === 0) return null;
  const meaning = entry.meanings[0];
  if (!meaning.definitions || meaning.definitions.length === 0) return null;
  const def = meaning.definitions[0].definition || null;
  return def;
}

function createSimpleTermSpan(rawWord, normalized) {
  const escaped = escapeHtml(rawWord);
  return `<span class="simple-term" data-term="${normalized}">${escaped}</span>`;
}

// ============= TOOLTIP =============

function showTooltip(term, definition, source, x, y) {
  tooltipTermEl.textContent = term;
  tooltipSourceEl.textContent = source;
  tooltipDefinitionEl.textContent = definition;
  tooltipEl.classList.remove("hidden");

  const tooltipRect = tooltipEl.getBoundingClientRect();
  const offset = 10;
  let left = x + offset;
  let top = y + offset;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (left + tooltipRect.width > viewportWidth - 10) {
    left = viewportWidth - tooltipRect.width - 10;
  }
  if (top + tooltipRect.height > viewportHeight - 10) {
    top = viewportHeight - tooltipRect.height - 10;
  }

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTooltip() {
  tooltipEl.classList.add("hidden");
}

// ============= UTILITIES =============

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============= INITIAL STATUS =============

setStatus("Paste a URL to begin.");
