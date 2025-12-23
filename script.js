// ============= CONFIG =============

// CORS-safe Mercury Parser endpoint
const MERCURY_ENDPOINT = "https://mercury-api.vercel.app/parser?url=";

// FreeDictionaryAPI endpoint
const DICT_ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en/";

// Very common English words to ignore for simple English layer
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

const STOP_WORDS = COMMON_WORDS;

// ============= SCIENTIFIC DICTIONARIES =============

const dictMicro = {
  pathogen: "A microorganism that can cause disease.",
  virulence: "The degree of pathogenicity of a microorganism.",
  biofilm: "A structured community of microorganisms within a matrix."
};

const dictGenetics = {
  genome: "The complete set of DNA in an organism.",
  allele: "One of two or more versions of a gene.",
  mutation: "A permanent change in DNA sequence."
};

const dictImmunology = {
  antigen: "A molecule recognized by the immune system.",
  antibody: "A protein produced by B cells that binds antigens.",
  cytokine: "A signaling protein in the immune system."
};

const dictBiology = {
  homeostasis: "Maintenance of internal stability.",
  metabolism: "Chemical processes that maintain life.",
  osmosis: "Diffusion of water across a membrane."
};

const dictChemistry = {
  molarity: "Concentration expressed as moles per liter.",
  catalyst: "A substance that speeds up a reaction.",
  polymer: "A molecule made of repeating units."
};

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

const englishDefinitionCache = new Map();
const scientificTermCache = new Map();

// ============= DOM REFERENCES =============

const articleUrlInput = document.getElementById("articleUrl");
const fetchArticleBtn = document.getElementById("fetchArticleBtn");
const dictionaryModeSelect = document.getElementById("dictionaryMode");
const toggleScientific = document.getElementById("toggleScientific");
const toggleSimpleEnglish = document.getElementById("toggleSimpleEnglish");

const statusMessageEl = document.getElementById("statusMessage");
const pubmedNotice = document.getElementById("pubmedNotice");

const articleTitleEl = document.getElementById("articleTitle");
const articleMetaEl = document.getElementById("articleMeta");
const articleContentEl = document.getElementById("articleContent");

const tooltipEl = document.getElementById("tooltip");
const tooltipTermEl = document.getElementById("tooltipTerm");
const tooltipSourceEl = document.getElementById("tooltipSource");
const tooltipDefinitionEl = document.getElementById("tooltipDefinition");

// ============= EVENT LISTENERS =============

fetchArticleBtn.addEventListener("click", () => {
  const url = articleUrlInput.value.trim();
  if (!url) {
    setStatus("Please enter a URL.", "error");
    return;
  }
  fetchAndAnalyzeArticle(url);
});

document.addEventListener("click", (e) => {
  if (!tooltipEl.contains(e.target)) hideTooltip();
});

articleContentEl.addEventListener("click", async (e) => {
  const target = e.target;

  if (target.classList.contains("sci-term")) {
    showTooltip(
      target.dataset.term,
      target.dataset.definition,
      target.dataset.source,
      e.pageX,
      e.pageY
    );
  }

  if (target.classList.contains("simple-term")) {
    const word = target.dataset.term;
    const defObj = englishDefinitionCache.get(word.toLowerCase());
    if (defObj?.definition) {
      showTooltip(word, defObj.definition, "Simple English dictionary", e.pageX, e.pageY);
    }
  }
});

// ============= STATUS =============

function setStatus(message, type = "info") {
  statusMessageEl.textContent = message;
  statusMessageEl.style.color =
    type === "error" ? "#b00020" :
    type === "success" ? "#2e7d32" :
    "#555";
}

// ============= MAIN EXTRACTION LOGIC =============

async function fetchAndAnalyzeArticle(url) {
  hideTooltip();
  setStatus("Processing URL…");
  fetchArticleBtn.disabled = true;
  pubmedNotice.textContent = "";

  if (isPubMedUrl(url)) {
    const pmid = extractPubMedId(url);
    if (!pmid) {
      setStatus("Could not extract PubMed ID.", "error");
      fetchArticleBtn.disabled = false;
      return;
    }

    setStatus("Fetching PubMed metadata…");
    const xml = await fetchPubMedMetadata(pmid);
    const doi = extractDOI(xml);
    const pmcid = extractPMCID(xml);
    const abstractText = extractAbstract(xml);

    if (pmcid) {
      pubmedNotice.textContent = "Using PMC full text (open access).";
      return fetchFullTextArticle(`https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/`);
    }

    if (doi) {
      pubmedNotice.textContent = "Trying publisher full text via DOI…";
      try {
        return fetchFullTextArticle(`https://doi.org/${doi}`);
      } catch (err) {
        console.warn("Publisher full text failed, falling back to abstract.");
      }
    }

    pubmedNotice.textContent = "Full text unavailable. Using PubMed abstract.";
    return displayAbstractOnly(xml, abstractText);
  }

  return fetchFullTextArticle(url);
}

// ============= FULL TEXT EXTRACTION =============

async function fetchFullTextArticle(url) {
  setStatus("Fetching full text…");

  try {
    const articleData = await getArticleFromMercury(url);

    if (!articleData?.content || articleData.content.trim() === "") {
      throw new Error("Empty full text returned");
    }

    articleTitleEl.textContent = articleData.title || "Untitled article";
    articleMetaEl.textContent = articleData.author || "";

    const textContent = extractTextFromHtml(articleData.content);
    const processedHtml = await annotateArticleText(textContent);
    articleContentEl.innerHTML = processedHtml;

    setStatus("Article processed successfully.", "success");
  } catch (err) {
    console.warn("Full text failed, falling back to abstract if available.");
    const pmid = extractPubMedId(articleUrlInput.value.trim());
    if (pmid) {
      const xml = await fetchPubMedMetadata(pmid);
      const abstractText = extractAbstract(xml);
      displayAbstractOnly(xml, abstractText);
      pubmedNotice.textContent = "Full text unavailable. Using PubMed abstract.";
      return;
    }
    setStatus("Could not extract article content from this URL.", "error");
  } finally {
    fetchArticleBtn.disabled = false;
  }
}

// ============= ABSTRACT FALLBACK =============

function displayAbstractOnly(xml, abstractText) {
  const title = xml.querySelector("ArticleTitle")?.textContent || "Untitled";
  const journal = xml.querySelector("Journal Title")?.textContent || "";
  const authors = [...xml.querySelectorAll("Author")].map(a => {
    const last = a.querySelector("LastName")?.textContent || "";
    const fore = a.querySelector("ForeName")?.textContent || "";
    return `${fore} ${last}`;
  }).join(", ");

  articleTitleEl.textContent = title;
  articleMetaEl.textContent = `${authors} • ${journal}`;
  articleContentEl.textContent = abstractText || "No abstract available.";

  setStatus("Abstract processed successfully.", "success");
}

// ============= MERCURY PARSER =============

async function getArticleFromMercury(url) {
  const endpoint = `${MERCURY_ENDPOINT}${encodeURIComponent(url)}`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("Mercury Parser request failed");
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
  const tokens = text.split(/(\s+|[,.!?;:()"'[\]{}])/);

  const dictMode = dictionaryModeSelect.value;
  const sciDict = SCI_DICTIONARIES[dictMode];
  const sciKeys = new Set(Object.keys(sciDict).map(k => k.toLowerCase()));

  const annotated = [];

  for (const token of tokens) {
    if (/^\s+$/.test(token) || /^[,.;:!?()"'[\]{}]$/.test(token)) {
      annotated.push(token);
      continue;
    }

    const raw = token;
    const norm = normalizeWord(raw);
    if (!norm) {
      annotated.push(raw);
      continue;
    }

    if (toggleScientific.checked && sciKeys.has(norm)) {
      annotated.push(createSciTermSpan(raw, norm, sciDict[norm], dictMode));
      continue;
    }

    if (STOP_WORDS.has(norm) || looksLikeName(raw)) {
      annotated.push(raw);
      continue;
    }

    if (toggleSimpleEnglish.checked && shouldTrySimpleEnglish(norm)) {
      const defObj = await getSimpleEnglishDefinition(norm);
      if (defObj?.definition) {
        annotated.push(createSimpleTermSpan(raw, norm));
        continue;
      }
    }

    annotated.push(raw);
  }

  return annotated.join("");
}

// ============= SCIENTIFIC TERM HELPERS =============

function normalizeWord(word) {
  return word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function createSciTermSpan(raw, norm, def, mode) {
  return `<span class="sci-term" data-term="${norm}" data-definition="${escapeHtml(def)}" data-source="${modeToSourceLabel(mode)}">${escapeHtml(raw)}</span>`;
}

function modeToSourceLabel(mode) {
  return {
    micro: "Microbiology glossary",
    genetics: "Genetics glossary",
    immunology: "Immunology glossary",
    biology: "Biology glossary",
    chemistry: "Chemistry / Biochemistry glossary"
  }[mode] || "Scientific glossary (combined)";
}

// ============= SIMPLE ENGLISH HELPERS =============

function looksLikeName(raw) {
  if (/[.@]/.test(raw)) return false;
  return /^[A-Z][a-z]+$/.test(raw);
}

function shouldTrySimpleEnglish(norm) {
  if (norm.length <= 3) return false;
  return !COMMON_WORDS.has(norm);
}

async function getSimpleEnglishDefinition(word) {
  const w = word.toLowerCase();
  if (englishDefinitionCache.has(w)) return englishDefinitionCache.get(w);

  try {
    const res = await fetch(DICT_ENDPOINT + w);
    if (!res.ok) {
      englishDefinitionCache.set(w, { definition: null });
      return englishDefinitionCache.get(w);
    }
    const data = await res.json();
    const def = extractFirstDefinition(data);
    englishDefinitionCache.set(w, { definition: def });
    return englishDefinitionCache.get(w);
  } catch {
    englishDefinitionCache.set(w, { definition: null });
    return englishDefinitionCache.get(w);
  }
}

function extractFirstDefinition(apiResponse) {
  if (!Array.isArray(apiResponse)) return null;
  const entry = apiResponse[0];
  const meaning = entry?.meanings?.[0];
  return meaning?.definitions?.[0]?.definition || null;
}

function createSimpleTermSpan(raw, norm) {
  return `<span class="simple-term" data-term="${norm}">${escapeHtml(raw)}</span>`;
}

// ============= TOOLTIP =============

function showTooltip(term, definition, source, x, y) {
  tooltipTermEl.textContent = term;
  tooltipSourceEl.textContent = source;
  tooltipDefinitionEl.textContent = definition;
  tooltipEl.classList.remove("hidden");

  const rect = tooltipEl.getBoundingClientRect();
  let left = x + 10;
  let top = y + 10;

  if (left + rect.width > window.innerWidth) {
    left = window.innerWidth - rect.width - 10;
  }
  if (top + rect.height > window.innerHeight) {
    top = window.innerHeight - rect.height - 10;
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

// ============= PUBMED HELPERS =============

function isPubMedUrl(url) {
  return url.includes("pubmed.ncbi.nlm.nih.gov");
}

function extractPubMedId(url) {
  const match = url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
  return match ? match[1] : null;
}

async function fetchPubMedMetadata(pmid) {
  const apiUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`;
  const res = await fetch(apiUrl);
  const xml = await res.text();
  return new DOMParser().parseFromString(xml, "text/xml");
}

function extractDOI(xml) {
  return xml.querySelector("ArticleId[IdType='doi']")?.textContent || null;
}

function extractPMCID(xml) {
  return xml.querySelector("ArticleId[IdType='pmc']")?.textContent || null;
}

function extractAbstract(xml) {
  return xml.querySelector("Abstract AbstractText")?.textContent || null;
}

// ============= INITIAL STATUS =============

setStatus("Paste a URL to begin.");
