#!/usr/bin/env node
// MicroSD Retro Gaming Tracker — Data Update Pipeline
// Usage: SCRAPER_API_KEY=xxx node update-data.js

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.SCRAPER_API_KEY;
if (!API_KEY) { console.error('SCRAPER_API_KEY not set'); process.exit(1); }

const DB_FILE = path.join(__dirname, 'products-db.json');
const CACHE_DIR = path.join(__dirname, 'api-cache');
const INDEX_FILE = path.join(__dirname, 'index.html');
const CACHE_TTL_DAYS = 15;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const QUERIES = [
  'Samsung EVO Select microSD card A2 256GB',
  'Samsung EVO Select microSD card A2 512GB',
  'Samsung Pro Plus microSD card A2 U3',
  'Samsung Pro Endurance microSD card high endurance',
  'SanDisk Extreme microSD card A2 U3 256GB',
  'SanDisk Extreme microSD card A2 U3 512GB',
  'SanDisk Extreme Pro microSD card A2 200MB',
  'SanDisk Ultra microSD card 256GB',
  'SanDisk Max Endurance microSD card surveillance',
  'Lexar PLAY microSD card gaming A2',
  'Kingston Canvas Select microSD card A1',
  'Kingston Canvas React microSD card A2 U3',
  'Kioxia Exceria microSD card 256GB',
  'PNY Elite X microSD card A2 512GB',
  'TeamGroup microSD card A2 gaming',
  'microSD card 512GB A2 retro gaming handheld',
  'microSD card 256GB A2 U3 emulator',
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cacheKey(query) {
  return path.join(CACHE_DIR, query.replace(/[^a-z0-9]/gi, '_').slice(0, 60) + '.json');
}

function cacheValid(file) {
  if (!fs.existsSync(file)) return false;
  const age = Date.now() - fs.statSync(file).mtimeMs;
  return age < CACHE_TTL_DAYS * 86400000;
}

async function fetchQuery(query) {
  const cFile = cacheKey(query);
  if (cacheValid(cFile)) {
    console.log(`  [cache] ${query.slice(0, 50)}`);
    return JSON.parse(fs.readFileSync(cFile));
  }
  const url = `https://api.scraperapi.com/structured/amazon/search?api_key=${API_KEY}&query=${encodeURIComponent(query)}&country=us`;
  console.log(`  [fetch] ${query.slice(0, 50)}`);
  await sleep(1500);
  const data = await fetchJson(url);
  fs.writeFileSync(cFile, JSON.stringify(data, null, 2));
  return data;
}

// --- Parsers ---

function parseCapacityGB(text) {
  const t = (text || '').toLowerCase();
  const tb = t.match(/(\d+(?:\.\d+)?)\s*tb\b/);
  if (tb) return Math.round(parseFloat(tb[1]) * 1024);
  const gb = t.match(/(\d+)\s*gb\b/);
  return gb ? parseInt(gb[1]) : 0;
}

function parseAppClass(text) {
  const t = (text || '').toUpperCase();
  if (/\bA2\b/.test(t)) return 'A2';
  if (/\bA1\b/.test(t)) return 'A1';
  return 'Unknown';
}

function parseSpeedClass(text) {
  const t = (text || '');
  if (/UHS-?II/i.test(t)) return 'UHS-II';
  if (/\bV30\b/i.test(t) || /\bU3\b/i.test(t)) return 'U3';
  if (/\bU1\b/i.test(t)) return 'U1';
  return 'C10';
}

function parseInterface(text) {
  return /UHS-?II/i.test(text) ? 'UHS-II' : 'UHS-I';
}

function parseReadSpeed(text) {
  const t = (text || '');
  const m = t.match(/(\d{2,3})\s*mb\/s\s*(?:read|r\/w)?/i) || t.match(/read[:\s]+(\d{2,3})\s*mb/i) || t.match(/(\d{2,3})\s*mb\/s/i);
  if (m) return parseInt(m[1]);
  return 0;
}

function parseWriteSpeed(text) {
  const m = (text || '').match(/(\d{2,3})\s*mb\/s\s*write|write[:\s]+(\d{2,3})\s*mb/i);
  return m ? parseInt(m[1] || m[2]) : 0;
}

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (/max endurance|pro endurance|high endurance|1\s*million\s*hour/i.test(t)) return 'High Endurance';
  if (/extreme pro|pro plus|pro ultimate|v60|v90|uhs-?ii/i.test(t)) return 'Speed';
  if (/extreme\b|canvas react|elite-?x|lexar play|\bplay\b.*gaming/i.test(t)) return 'Gaming/Speed';
  if (/evo select|evo plus|ultra\b|canvas select|exceria\b|elite\b(?!-)/i.test(t)) return 'Value';
  if (/kioxia|pny|teamgroup|inland|verbatim|transcend/i.test(t)) return 'Budget';
  return 'Value';
}

function detectFeatures(title, brand) {
  const t = (title || '') + ' ' + (brand || '');
  const feats = [];
  if (/max endurance|pro endurance/i.test(t)) feats.push('Max Endurance');
  else if (/high endurance|endurance/i.test(t)) feats.push('High Endurance');
  if (/waterproof|water[\s-]resistant|ipx7/i.test(t)) feats.push('Waterproof');
  if (/shockproof|shock[\s-]resistant/i.test(t)) feats.push('Shockproof');
  if (/samsung|sandisk|lexar|kingston/i.test(t)) feats.push('Trusted Brand');
  return feats;
}

function detectClaims(capacityGB, category, pricePerGB) {
  const claims = [];
  claims.push('Single Slot');
  if (capacityGB <= 64) claims.push('Dual Slot - OS');
  if (capacityGB >= 128) claims.push('Dual Slot - ROMs');
  if (capacityGB >= 512) claims.push('PS2 Ready');
  if (capacityGB <= 128) claims.push('Starter Pack');
  if (category === 'High Endurance') { if (!claims.includes('Dual Slot - OS')) claims.push('Dual Slot - OS'); }
  if (pricePerGB && pricePerGB < 0.08) claims.push('Budget Pick');
  return [...new Set(claims)];
}

function getTargetGen(capacityGB) {
  if (capacityGB <= 32) return 'Up to 8-bit/16-bit';
  if (capacityGB <= 64) return 'Up to GBA/Neo Geo';
  if (capacityGB <= 128) return 'Up to PS1';
  if (capacityGB <= 256) return 'Up to PSP/N64';
  if (capacityGB <= 512) return 'Up to PS2/GCN (light)';
  return 'Full PS2/GCN sets';
}

function computeValueScore(pricePerGB, appClass, speedClass, category) {
  if (!pricePerGB || pricePerGB <= 0) return 0;
  const best = 0.055;
  let s = Math.min(95, Math.round((best / pricePerGB) * 80));
  if (appClass === 'A2') s = Math.min(100, s + 8);
  if (speedClass === 'U3') s = Math.min(100, s + 5);
  if (category === 'High Endurance') s = Math.max(0, s - 15);
  return s;
}

function extractBrand(title) {
  const brands = ['Samsung','SanDisk','Lexar','Kingston','Kioxia','PNY','TeamGroup','Inland','Transcend','Sony','Verbatim','Silicon Power'];
  for (const b of brands) if (title.toLowerCase().includes(b.toLowerCase())) return b;
  return title.split(' ')[0];
}

function isMicroSD(title) {
  return /microsd|micro\s*sd|tf\s*card|flash\s*card/i.test(title) && !/reader|adapter|hub|case|wallet|sleeve/i.test(title);
}

function normalizeItem(raw) {
  const title = raw.name || raw.title || '';
  if (!isMicroSD(title)) return null;
  const price = parseFloat(raw.price || raw.price_string?.replace(/[^0-9.]/g,'') || 0);
  if (!price || price < 3 || price > 250) return null;
  const capacityGB = parseCapacityGB(title);
  if (!capacityGB || capacityGB < 8) return null;
  const pricePerGB = Math.round((price / capacityGB) * 1000) / 1000;
  if (pricePerGB > 2) return null; // outlier filter
  const brand = extractBrand(title);
  const fullText = title + ' ' + (raw.description || '');
  const appClass = parseAppClass(fullText);
  const speedClass = parseSpeedClass(fullText);
  const iface = parseInterface(fullText);
  const readSpeed = parseReadSpeed(fullText);
  const writeSpeed = parseWriteSpeed(fullText);
  const category = detectCategory(title);
  const features = detectFeatures(title, brand);
  const claims = detectClaims(capacityGB, category, pricePerGB);
  const certs = [appClass !== 'Unknown' ? appClass : null, speedClass !== 'C10' ? speedClass : null, iface, readSpeed > 150 ? 'V30' : null].filter(Boolean);
  return {
    id: raw.asin || (brand + '_' + capacityGB + '_' + Date.now()).replace(/\s/g,'_').slice(0,40),
    brand, model: title.replace(brand,'').trim().split(/\s+/).slice(0,4).join(' '),
    title: title.slice(0, 120),
    capacityGB, price, pricePerGB,
    appClass: appClass !== 'Unknown' ? appClass : 'A1',
    speedClass, interface: iface, readSpeed, writeSpeed,
    category, targetGen: getTargetGen(capacityGB),
    valueScore: computeValueScore(pricePerGB, appClass, speedClass, category),
    image: raw.image || raw.thumbnail || null,
    amazonUrl: `https://www.amazon.com/dp/${raw.asin || ''}`,
    certs: [...new Set(certs)],
    features: [...new Set(features)],
    claims: [...new Set(claims)],
    updatedAt: new Date().toISOString().slice(0,10)
  };
}

function dedup(items) {
  const seen = new Map();
  for (const item of items) {
    const key = `${item.brand}_${item.capacityGB}_${item.category}_${item.appClass}`;
    if (!seen.has(key) || item.price < seen.get(key).price) seen.set(key, item);
  }
  return [...seen.values()];
}

function buildStaticRow(item) {
  const imgSrc = item.image || `https://placehold.co/44x44/0f1420/34d399?text=${item.brand.slice(0,2).toUpperCase()}`;
  const classBadge = item.appClass === 'A2'
    ? '<span class="badge badge-a2">A2</span>'
    : '<span class="badge badge-a1">A1</span>';
  const speedBadges = item.certs.filter(c => ['U3','V30','U1'].includes(c)).map(c => `<span class="badge badge-cert">${c}</span>`).join('');
  const ifaceBadge = `<span class="badge badge-cert">${item.interface}</span>`;
  const slotBadges = item.claims.filter(c => c.startsWith('Single') || c.startsWith('Dual')).map(c => `<span class="badge badge-${c.includes('OS') ? 'claim' : 'free'}">${c}</span>`).join('');
  const scoreClass = item.valueScore >= 80 ? 'score-hi' : item.valueScore >= 60 ? 'score-mid' : 'score-lo';
  const catBadge = `<span class="badge ${item.category === 'High Endurance' ? 'badge-warn' : item.category === 'Speed' ? 'badge-cert' : 'badge-free'}">${item.category}</span>`;
  const relBadge = item.features.includes('Trusted Brand')
    ? '<span class="badge badge-cert">Trusted</span>'
    : '<span class="badge badge-free">Standard</span>';
  const allTagsAttr = [...item.certs,...item.features,...item.claims].join(',');
  return `<tr data-id="${item.id}" data-tags="${allTagsAttr}">
<td class="col-essential col-img"><img src="${imgSrc}" alt="${item.brand} ${item.model} ${item.capacityGB}GB" loading="lazy" width="44" height="44"></td>
<td class="col-essential col-brand">${item.brand}</td>
<td class="col-essential col-model" title="${item.title}">${item.model}</td>
<td class="col-essential col-cap">${item.capacityGB}GB</td>
<td class="col-essential col-price">$${item.price.toFixed(2)}</td>
<td class="col-essential col-ppg">$${item.pricePerGB.toFixed(3)}</td>
<td class="col-essential col-class">${classBadge}</td>
<td class="col-essential col-buy"><a href="${item.amazonUrl}?tag=retromicrosd-20" rel="nofollow sponsored" class="buy-btn" target="_blank">Buy →</a></td>
<td class="col-speed col-read">${item.readSpeed || '—'}</td>
<td class="col-speed col-write">${item.writeSpeed || '—'}</td>
<td class="col-speed col-iface">${ifaceBadge}</td>
<td class="col-speed col-spclass">${speedBadges}</td>
<td class="col-compat col-setup">${slotBadges}</td>
<td class="col-compat col-gen">${item.targetGen}</td>
<td class="col-compat col-consoles">${(item.compatConsoles || []).join(', ')}</td>
<td class="col-value col-score"><span class="${scoreClass}">${item.valueScore}</span></td>
<td class="col-value col-cat">${catBadge}</td>
<td class="col-value col-rel">${relBadge}</td>
</tr>`;
}

function updateHtml(products) {
  let html = fs.readFileSync(INDEX_FILE, 'utf8');

  // Update JSON data block
  const jsonStr = JSON.stringify(products, null, 2);
  html = html.replace(/(\/\* START_JSON_DATA \*\/[\s\S]*?const PRODUCTS_DATA = )[\s\S]*?(;[\s\n]*\/\* END_JSON_DATA \*\/)/, `$1${jsonStr};$2`);

  // Update static rows
  const rows = products.sort((a,b) => b.valueScore - a.valueScore).map(buildStaticRow).join('\n');
  html = html.replace(/(<!-- START_TABLE_ROWS -->)[\s\S]*?(<!-- END_TABLE_ROWS -->)/, `$1\n${rows}\n$2`);

  // Update stats bar
  const sorted = [...products].sort((a,b) => a.pricePerGB - b.pricePerGB);
  const lowest = sorted[0]?.pricePerGB;
  const a2count = products.filter(p => p.appClass === 'A2').length;
  const avg = products.reduce((s,p) => s + p.pricePerGB, 0) / products.length;
  html = html.replace(/(<div class="stat-val" id="stat-total">)[\d]+(<\/div>)/, `$1${products.length}$2`);
  html = html.replace(/(<div class="stat-val" id="stat-low">)\$[\d.]+(<\/div>)/, `$1$${lowest?.toFixed(3)}$2`);
  html = html.replace(/(<div class="stat-val" id="stat-a2">)[\d]+(<\/div>)/, `$1${a2count}$2`);
  html = html.replace(/(<div class="stat-val" id="stat-avg">)\$[\d.]+(<\/div>)/, `$1$${avg?.toFixed(3)}$2`);

  fs.writeFileSync(INDEX_FILE, html);
  console.log(`Updated index.html: ${products.length} products, lowest $/GB: $${lowest?.toFixed(3)}, avg: $${avg?.toFixed(3)}`);
}

async function main() {
  console.log('=== MicroSD Retro Gaming Tracker Update ===');
  let db = [];
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE));
    console.log(`Loaded ${db.length} existing products from DB`);
  }

  const raw = [];
  for (const query of QUERIES) {
    try {
      const res = await fetchQuery(query);
      const products = res.results || res.products || [];
      raw.push(...products);
      console.log(`  → ${products.length} results`);
    } catch (e) {
      console.error(`  Error for "${query}": ${e.message}`);
    }
  }

  console.log(`\nProcessing ${raw.length} raw results...`);
  const normalized = raw.map(normalizeItem).filter(Boolean);
  console.log(`Normalized: ${normalized.length} valid microSD cards`);

  // Merge with existing DB
  const merged = new Map(db.map(p => [p.id, p]));
  for (const item of normalized) merged.set(item.id, { ...merged.get(item.id), ...item });

  // Re-enrichment pass
  let enriched = 0;
  for (const [, p] of merged) {
    const freshScore = computeValueScore(p.pricePerGB, p.appClass, p.speedClass, p.category);
    if (freshScore !== p.valueScore) { p.valueScore = freshScore; enriched++; }
    p.targetGen = getTargetGen(p.capacityGB);
  }
  if (enriched > 0) console.log(`Re-enriched ${enriched} products`);

  const final = dedup([...merged.values()]).filter(p => p.capacityGB >= 8 && p.price > 0).sort((a,b) => b.valueScore - a.valueScore);
  console.log(`Final DB: ${final.length} products after dedup`);

  fs.writeFileSync(DB_FILE, JSON.stringify(final, null, 2));
  console.log('Saved products-db.json');

  updateHtml(final);
  console.log('\n✅ Done. Commit and push to deploy.');
}

main().catch(e => { console.error(e); process.exit(1); });
