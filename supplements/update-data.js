/**
 * Amazon Supplements pSEO Scraper
 * File: update-supplements.js
 *
 * MODES:
 *   node update-supplements.js          → Light update (page 1 only)
 *   node update-supplements.js --full   → Full scrape (all queries × 3 pages)
 *   node update-supplements.js --mock   → Dev mode with mock data (no API credits)
 *
 * PIPELINE:
 *   ScraperAPI Amazon Search → products-db.json → index.html injection
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CONFIGURATION
// ==========================================
const SCRAPERAPI_KEY = process.env.SCRAPER_API_KEY || '9e6091af4f7987d1f035fa0490980022';
const SCRAPERAPI_SEARCH = 'https://api.scraperapi.com/structured/amazon/search';
const SCRAPERAPI_PRODUCT = 'https://api.scraperapi.com/structured/amazon/product';

const DB_FILE = path.join(__dirname, 'products-db.json');
const HTML_FILE = path.join(__dirname, 'index.html');
const CACHE_DIR = path.join(__dirname, 'api-cache');
const CACHE_TTL_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

const IS_FULL = process.argv.includes('--full');
const IS_MOCK = process.argv.includes('--mock');
const MAX_PAGES = IS_FULL ? 3 : 1;

const QUERIES = [
    // Whey Protein
    'gluten free whey protein powder',
    'NSF certified whey protein',
    'third party tested whey protein',
    'clean label whey protein no artificial sweeteners',
    // Pre-Workout
    'clean pre workout no artificial sweeteners',
    'NSF certified pre workout',
    'sucralose free pre workout',
    'third party tested pre workout',
    // Creatine
    'creatine monohydrate third party tested',
    'NSF certified creatine',
    'clean creatine no fillers',
    // Electrolytes
    'clean electrolyte powder no sugar',
    'electrolyte powder no artificial sweeteners',
    'NSF certified electrolytes',
    'LMNT alternative electrolyte powder',
    'keto electrolyte powder high sodium',
    'bulk electrolyte powder price per serving',
    // Multivitamin
    'third party tested multivitamin',
    'NSF certified multivitamin',
    'clean multivitamin no fillers',
    'gluten free multivitamin USP verified',
    // Fish Oil / Omega-3
    'fish oil omega 3 high EPA DHA',
    'triple strength omega 3 fish oil',
    'IFOS certified fish oil',
    'best value omega 3 price per gram',
    'liquid fish oil high potency',
    'algae omega 3 vegan DHA',
    'fish oil no burp enteric coated',
    // Probiotics
    'probiotics third party tested',
    'best probiotics CFU count billion',
    'shelf stable probiotics no refrigeration',
    'women probiotics gut health',
    'probiotics with prebiotics synbiotic',
    'NSF certified probiotics',
    // Berberine
    'berberine supplement blood sugar support',
    'berberine HCl third party tested',
    'berberine 500mg best value',
    'dihydroberberine supplement DHB',
    'berberine NSF certified clean label',
    'best berberine price per 500mg',
];

// ==========================================
// 2. CATEGORY DETECTION
// ==========================================
function detectCategory(title) {
    const t = (title || '').toLowerCase();
    if (/whey|protein powder|isolate|casein/.test(t)) return 'Whey';
    if (/pre[\s-]?work|preworkout|pre workout/.test(t)) return 'Pre-Workout';
    if (/creatine|creapure/.test(t)) return 'Creatine';
    if (/electrolyte|hydration|lyte/.test(t)) return 'Electrolytes';
    if (/multivitamin|multi[\s-]?vitamin|daily vitamin/.test(t)) return 'Multivitamin';
    if (/fish oil|omega[\s-]?3|epa.*dha|dha.*epa|cod liver oil|krill oil|algae.*omega/.test(t)) return 'Fish Oil';
    if (/probiotic|acidophilus|lactobacillus|bifidobacterium|gut flora|digestive enzymes.*probiotic/i.test(t)) return 'Probiotics';
    if (/berberine/i.test(t)) return 'Berberine';
    if (/bcaa|amino|eaa/.test(t)) return 'Amino Acids';
    if (/collagen/.test(t)) return 'Collagen';
    return 'Other';
}

// ==========================================
// 3. TAG DETECTION FROM TITLE/DESCRIPTION
// ==========================================
const CERTIFICATION_PATTERNS = [
    { regex: /\bUSP\b/i, tag: 'USP' },
    { regex: /\bNSF\b/i, tag: 'NSF' },
    { regex: /informed[\s-]?sport/i, tag: 'Informed-Sport' },
    { regex: /informed[\s-]?choice/i, tag: 'Informed-Choice' },
    { regex: /consumer\s?lab/i, tag: 'ConsumerLab' },
    { regex: /\bcGMP\b/i, tag: 'cGMP' },
    { regex: /third[\s-]?party[\s-]?test/i, tag: 'Third-Party Tested' },
    { regex: /\bIFOS\b/i, tag: 'IFOS' },
];

const FREE_FROM_PATTERNS = [
    { regex: /gluten[\s-]?free/i, tag: 'Gluten-Free' },
    { regex: /sucralose[\s-]?free/i, tag: 'Sucralose-Free' },
    { regex: /aspartame[\s-]?free/i, tag: 'Aspartame-Free' },
    { regex: /no artificial (color|flavor|sweetener)/gi, tag: 'No Artificial' },
    { regex: /non[\s-]?gmo/i, tag: 'Non-GMO' },
    { regex: /stevia/i, tag: 'Stevia' },
    { regex: /soy[\s-]?free/i, tag: 'Soy-Free' },
    { regex: /dairy[\s-]?free/i, tag: 'Dairy-Free' },
    { regex: /vegan/i, tag: 'Vegan' },
    { regex: /keto/i, tag: 'Keto-Friendly' },
    { regex: /organic/i, tag: 'Organic' },
];

const FILLER_PATTERNS = [
    'maltodextrin', 'dextrose', 'silica', 'magnesium stearate',
    'titanium dioxide', 'carrageenan', 'acesulfame',
];

const CLAIM_PATTERNS = [
    { regex: /shelf[\s-]?stable/i, tag: 'Shelf-Stable' },
    { regex: /delayed[\s-]?release/i, tag: 'Delayed Release' },
    { regex: /transparent\s*label/i, tag: 'Transparent Label' },
    { regex: /clinically\s*(studied|dosed|proven)/i, tag: 'Clinically Studied' },
    { regex: /lab[\s-]?tested/i, tag: 'Lab Tested' },
    { regex: /grass[\s-]?fed/i, tag: 'Grass-Fed' },
    { regex: /cold[\s-]?process/i, tag: 'Cold-Processed' },
    { regex: /zero sugar|sugar[- ]free|no sugar/i, tag: 'Sugar-Free' },
    { regex: /1000\s*mg.*(?:sodium|potassium)|(?:sodium|potassium).*1000\s*mg|high sodium/i, tag: 'High Sodium' },
    { regex: /berberine\s*hcl/i, tag: 'Berberine HCl' },
    { regex: /dihydroberberine|\bdhb\b/i, tag: 'Dihydroberberine' },
    { regex: /blood\s*sugar\s*support/i, tag: 'Blood Sugar Support' },
    { regex: /glp[\s-]?1/i, tag: 'GLP-1 Support' },
];

function detectTags(text) {
    const t = (text || '');
    const certs = CERTIFICATION_PATTERNS.filter(p => p.regex.test(t)).map(p => p.tag);
    const freeFrom = FREE_FROM_PATTERNS.filter(p => p.regex.test(t)).map(p => p.tag);
    const fillers = FILLER_PATTERNS.filter(f => t.toLowerCase().includes(f));
    const claims = CLAIM_PATTERNS.filter(p => p.regex.test(t)).map(p => p.tag);
    const proprietary = /proprietary\s*(blend|formula|mix)/i.test(t);
    return { certs, freeFrom, fillers, claims, proprietary };
}

function parseEpaDha(text) {
    const t = (text || '');
    let epa = 0, dha = 0;
    const epaMatch = t.match(/(\d+)\s*mg\s*(?:of\s*)?EPA/i) || t.match(/EPA\s*(\d+)\s*mg/i);
    const dhaMatch = t.match(/(\d+)\s*mg\s*(?:of\s*)?DHA/i) || t.match(/DHA\s*(\d+)\s*mg/i);
    if (epaMatch) epa = parseInt(epaMatch[1]);
    if (dhaMatch) dha = parseInt(dhaMatch[1]);
    if (epa === 0 && dha === 0) {
        const combo = t.match(/(\d+)\s*mg\s*(?:omega[\s-]?3|EPA[\s+&\/]DHA|total\s*omega)/i);
        if (combo) { epa = Math.round(parseInt(combo[1]) * 0.6); dha = Math.round(parseInt(combo[1]) * 0.4); }
    }
    return { epa, dha, totalOmega3: epa + dha };
}

function parseCFU(text) {
    const t = (text || '');
    const b = t.match(/(\d+)\s*billion\s*(?:CFU|cfu|active|live)/i);
    if (b) return parseInt(b[1]);
    const b2 = t.match(/(\d+)\s*(?:B|bil)\s*CFU/i);
    if (b2) return parseInt(b2[1]);
    const raw = t.match(/(\d[\d,]+)\s*CFU/i);
    if (raw) return Math.round(parseInt(raw[1].replace(/,/g, '')) / 1e9);
    return 0;
}

function parseBerberineMg(text) {
    const t = (text || '');
    const explicit = t.match(/(\d+)\s*mg\s*(?:of\s*)?(?:berberine|berberine\s*hcl)/i) ||
                     t.match(/berberine(?:\s*hcl)?\s*(\d+)\s*mg/i);
    if (explicit) return parseInt(explicit[1]);
    // Dihydroberberine is ~2x more bioavailable — treat 250mg DHB as 500mg equivalent
    const dhb = t.match(/(\d+)\s*mg\s*dihydroberberine/i);
    if (dhb) return parseInt(dhb[1]) * 2;
    // Default: standard berberine capsule = 500mg
    if (/berberine/i.test(t)) return 500;
    return 0;
}

function parseBerberineForm(text) {
    const t = (text || '');
    if (/phytosome|berbevis/i.test(t)) return 'Phytosome';
    if (/dihydroberberine|\bdhb\b/i.test(t)) return 'Dihydroberberine';
    if (/berberine\s*hcl/i.test(t)) return 'HCl';
    // Complex = berberine + other metabolic ingredients
    if (/cinnamon|chromium|alpha[\s-]?lipoic|gymnema|bitter\s*melon|banaba|mulberry/i.test(t)) return 'Complex';
    return 'HCl';
}

const BERBERINE_COMPLEX_PATTERNS = [
    { regex: /ceylon\s*cinnamon/i, tag: 'Ceylon Cinnamon' },
    { regex: /cinnamon(?!\s*extract\s*\d)/i, tag: 'Cinnamon' },
    { regex: /chromium/i, tag: 'Chromium' },
    { regex: /alpha[\s-]?lipoic/i, tag: 'Alpha Lipoic Acid' },
    { regex: /gymnema/i, tag: 'Gymnema' },
    { regex: /bitter\s*melon/i, tag: 'Bitter Melon' },
    { regex: /banaba/i, tag: 'Banaba Leaf' },
    { regex: /mulberry/i, tag: 'Mulberry' },
];

// ==========================================
// 4. SERVING/SIZE PARSING
// ==========================================
function parseServings(title) {
    const m = title.match(/(\d+)\s*serv/i);
    if (m) return parseInt(m[1]);
    const alt = title.match(/(\d+)\s*(?:stickpack|stick\s*pack|packet|ct\b|count|pouch|sachet|stick|(?:veggie\s*|vegetarian\s*|veg\s*|delayed[\s-]?release\s*|enteric[\s-]?coated\s*|mini\s*)?capsule|(?:veggie\s*|veg\s*)?cap|tablet|softgel|soft\s*gel|gummie|gummy|chew|lozenge|piece|pop|dose)s?\b/i);
    if (alt) return parseInt(alt[1]);
    const packOf = title.match(/pack\s*of\s*(\d+)/i);
    if (packOf && parseInt(packOf[1]) > 1) return parseInt(packOf[1]);
    const countDash = title.match(/(\d+)[-\s](?:count|ct|pack)\b/i);
    if (countDash && parseInt(countDash[1]) > 1) return parseInt(countDash[1]);
    return null;
}

function parseWeight(title) {
    const oz = title.match(/(\d+(?:\.\d+)?)\s*oz/i);
    if (oz) return { value: parseFloat(oz[1]), unit: 'oz' };
    const lb = title.match(/(\d+(?:\.\d+)?)\s*(?:lb|pound)/i);
    if (lb) return { value: parseFloat(lb[1]) * 16, unit: 'oz' };
    const g = title.match(/(\d+(?:\.\d+)?)\s*g(?:ram)?/i);
    if (g) return { value: parseFloat(g[1]), unit: 'g' };
    const kg = title.match(/(\d+(?:\.\d+)?)\s*kg/i);
    if (kg) return { value: parseFloat(kg[1]) * 1000, unit: 'g' };
    return null;
}

function parsePrice(raw) {
    if (typeof raw === 'number') return raw;
    const m = String(raw || '').match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
}

// ==========================================
// 5. SCORING
// ==========================================
function computeTrustScore(product) {
    let score = 0;
    score += product.thirdPartyFlag ? 40 : 0;
    score += Math.min((product.avgRating || 0) / 5, 1) * 20;
    score += product.servingsVerified ? 15 : 0;
    score += product.proprietaryBlend ? 0 : 15;
    score += product.fillers.length === 0 ? 10 : 0;
    return Math.round(score);
}

function computeGapScore(product, categoryMedianPrice, categoryMedianReviews) {
    let score = 0;
    // Below-median price = great value (30pts)
    if (product.pricePerServing && categoryMedianPrice) {
        score += product.pricePerServing < categoryMedianPrice ? 30 : 0;
    }
    // Third-party certified (25pts)
    score += product.thirdPartyFlag ? 25 : 0;
    // Clean label breadth: 2+ free-from tags (15pts)
    score += product.freeFromTags.length >= 2 ? 15 : 0;
    // Open label, no proprietary blend (15pts)
    score += product.proprietaryBlend ? 0 : 15;
    // Strong rating: 4.3+ stars (15pts)
    score += (product.avgRating || 0) >= 4.3 ? 15 : 0;
    return Math.min(100, Math.round(score));
}

// ==========================================
// 6. CACHE
// ==========================================
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

async function fetchWithCache(url, cacheKey) {
    const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
    if (fs.existsSync(cacheFile)) {
        const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
        if (age < CACHE_TTL_MS) {
            console.log(`  💾 Cache HIT: ${cacheKey}`);
            return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        }
    }
    console.log(`  📡 API fetch: ${cacheKey}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    return data;
}

// ==========================================
// 7. MOCK DATA — DISABLED (now using real ScraperAPI Amazon data in production)
// ==========================================
// function generateMockData() { ... }
// Mock data was used during development. Now disabled.
// To re-enable for dev, uncomment the full function in git history (commit 4cddb4c).

// ==========================================
// 8. NORMALIZE RAW AMAZON ITEM
// ==========================================
function normalizeAmazonItem(raw) {
    const title = raw.title || raw.name || '';
    const price = parsePrice(raw.price || raw.price_string || raw.buybox_price);
    const servings = parseServings(title);
    const weight = parseWeight(title);
    const fullText = title + ' ' + (raw.description || '') + ' ' + (raw.feature_bullets || []).join(' ');
    const tags = detectTags(fullText);
    const category = detectCategory(title);

    // EPA/DHA parsing for Fish Oil products
    const omega = category === 'Fish Oil' ? parseEpaDha(fullText) : { epa: 0, dha: 0, totalOmega3: 0 };
    const pricePerGramOmega3 = (omega.totalOmega3 > 0 && servings && price)
        ? Math.round((price / (omega.totalOmega3 * servings / 1000)) * 100) / 100
        : null;

    // CFU parsing for Probiotics — price per 10 billion CFU
    const cfuBillions = category === 'Probiotics' ? parseCFU(fullText) : 0;
    const pricePer10bCFU = (cfuBillions > 0 && servings && price)
        ? Math.round((price / (cfuBillions * servings / 10)) * 100) / 100
        : null;

    // Berberine mg — price per 500mg dose + form + complex ingredients
    const berberineMg = category === 'Berberine' ? parseBerberineMg(fullText) : 0;
    const pricePer500mg = (berberineMg > 0 && servings && price)
        ? Math.round((price / (berberineMg * servings / 500)) * 100) / 100
        : null;
    const berberineForm = category === 'Berberine' ? parseBerberineForm(fullText) : null;
    const complexIngredients = category === 'Berberine'
        ? BERBERINE_COMPLEX_PATTERNS.filter(p => p.regex.test(fullText)).map(p => p.tag)
        : [];

    return {
        id: raw.asin || raw.product_id || raw.id,
        scrapeDate: new Date().toISOString().split('T')[0],
        marketplace: 'Amazon US',
        brand: raw.brand || extractBrand(title),
        title: title,
        asinUrl: raw.url || raw.link || `https://www.amazon.com/dp/${raw.asin}`,
        category: category,
        priceListed: price,
        shippingInfo: (raw.is_prime || raw.has_prime) ? 'Prime' : (raw.shipping || 'Standard'),
        servingsDeclared: servings,
        totalWeight: weight ? `${weight.value} ${weight.unit}` : null,
        pricePerServing: (servings && price) ? Math.round((price / servings) * 100) / 100 : null,
        servingsVerified: !!servings,
        thirdPartyCerts: tags.certs,
        thirdPartyFlag: tags.certs.length > 0,
        freeFromTags: tags.freeFrom,
        proprietaryBlend: tags.proprietary,
        fillers: tags.fillers,
        additivesFlag: tags.fillers.length > 0,
        claims: tags.claims,
        epaMg: omega.epa,
        dhaMg: omega.dha,
        totalOmega3Mg: omega.totalOmega3,
        pricePerGramOmega3: pricePerGramOmega3,
        cfuBillions: cfuBillions,
        pricePer10bCFU: pricePer10bCFU,
        berberineMg: berberineMg,
        pricePer500mg: pricePer500mg,
        berberineForm: berberineForm,
        complexIngredients: complexIngredients,
        reviewsCount: raw.total_reviews || raw.reviews_count || raw.ratings_total || parseInt(raw.reviews) || 0,
        avgRating: parseFloat(raw.rating || raw.stars || 0),
        sponsoredFlag: !!raw.is_sponsored,
        image: raw.image || raw.image_url || raw.thumbnail || null,
        matchedKeywords: [],
        trustScore: 0,
        gapScore: 0,
    };
}

function extractBrand(title) {
    const words = title.split(/[\s,\-–]+/);
    return words.slice(0, 2).join(' ');
}

// ==========================================
// 9. COMPUTE SCORES
// ==========================================
function computeAllScores(products) {
    const categories = {};
    for (const p of products) {
        if (!categories[p.category]) categories[p.category] = [];
        categories[p.category].push(p);
    }

    for (const [cat, items] of Object.entries(categories)) {
        const prices = items.filter(p => p.pricePerServing > 0).map(p => p.pricePerServing).sort((a, b) => a - b);
        const reviews = items.map(p => p.reviewsCount || 0).sort((a, b) => a - b);
        const medianPrice = prices[Math.floor(prices.length / 2)] || 0;
        const medianReviews = reviews[Math.floor(reviews.length / 2)] || 0;

        for (const p of items) {
            p.trustScore = computeTrustScore(p);
            p.gapScore = computeGapScore(p, medianPrice, medianReviews);
        }
    }
}

// ==========================================
// 10. HTML INJECTION
// ==========================================
function buildStaticRow(item) {
    const certBadges = (item.thirdPartyCerts || []).map(c => `<span class="badge badge-cert">${c}</span>`).join('');
    const freeFromBadges = (item.freeFromTags || []).map(t => `<span class="badge badge-free">${t}</span>`).join('');
    const fillerBadges = (item.fillers || []).map(f => `<span class="badge badge-filler">${f}</span>`).join('');
    const claimBadges = (item.claims || []).map(c => `<span class="badge badge-claim">${c}</span>`).join('');
    const primeIcon = item.shippingInfo === 'Prime' ? '<span class="prime-badge">Prime</span>' : '';
    const propBlend = item.proprietaryBlend ? '<span class="badge badge-warn">Proprietary Blend</span>' : '<span class="badge badge-ok">Open Label</span>';
    const trustClass = item.trustScore >= 70 ? 'score-high' : item.trustScore >= 40 ? 'score-mid' : 'score-low';
    const gapClass = item.gapScore >= 60 ? 'score-high' : item.gapScore >= 30 ? 'score-mid' : 'score-low';
    const omegaBadge = (item.totalOmega3Mg > 0)
        ? `<span class="badge badge-cert">EPA ${item.epaMg}mg</span><span class="badge badge-cert">DHA ${item.dhaMg}mg</span>${item.pricePerGramOmega3 ? '<span class="badge badge-free">$' + item.pricePerGramOmega3.toFixed(2) + '/g Ω3</span>' : ''}`
        : '';
    const cfuBadge = (item.cfuBillions > 0)
        ? `<span class="badge badge-cert">${item.cfuBillions}B CFU</span>${item.pricePer10bCFU ? '<span class="badge badge-free">$' + item.pricePer10bCFU.toFixed(2) + '/10B CFU</span>' : ''}`
        : '';
    const formColors = { 'Phytosome': 'badge-cert', 'Dihydroberberine': 'badge-claim', 'HCl': 'badge-none', 'Complex': 'badge-warn' };
    const berberineBadge = (item.berberineMg > 0)
        ? `<span class="badge badge-cert">${item.berberineMg}mg Berberine</span>${item.pricePer500mg ? '<span class="badge badge-free">$' + item.pricePer500mg.toFixed(2) + '/500mg</span>' : ''}${item.berberineForm ? '<span class="badge ' + (formColors[item.berberineForm] || 'badge-none') + '">' + item.berberineForm + '</span>' : ''}${(item.complexIngredients || []).map(c => '<span class="badge badge-warn">' + c + '</span>').join('')}`
        : '';

    const imgHtml = item.image ? `<img src="${item.image}" alt="${item.brand}" loading="lazy" class="product-thumb">` : '';

    return `                    <tr data-category="${item.category}" data-brand="${item.brand}" data-id="${item.id}">
                        <td class="col-essential col-img">${imgHtml}</td>
                        <td class="col-essential">${item.brand}</td>
                        <td class="col-essential col-title"><a href="${item.asinUrl}" target="_blank" rel="nofollow sponsored">${item.title}</a></td>
                        <td class="col-essential">${item.category}</td>
                        <td class="col-essential">$${item.priceListed.toFixed(2)} ${primeIcon}</td>
                        <td class="col-essential">${item.servingsDeclared || '—'}</td>
                        <td class="col-essential col-highlight">${item.pricePerServing ? '$' + item.pricePerServing.toFixed(2) : '—'}</td>
                        <td class="col-essential">${item.avgRating > 0 ? '⭐ ' + item.avgRating.toFixed(1) : '—'}</td>
                        <td class="col-essential">${(item.reviewsCount || 0).toLocaleString()}</td>
                        <td class="col-ingredients">${propBlend}</td>
                        <td class="col-ingredients">${freeFromBadges || '—'}</td>
                        <td class="col-ingredients">${fillerBadges || '<span class="badge badge-ok">None</span>'}</td>
                        <td class="col-ingredients">${claimBadges}${omegaBadge || ''}${cfuBadge || ''}${berberineBadge || ''}</td>
                        <td class="col-trust">${certBadges || '<span class="badge badge-none">None</span>'}</td>
                        <td class="col-trust"><span class="${trustClass}">${item.trustScore}</span></td>
                        <td class="col-value"><span class="${gapClass}">${item.gapScore}</span></td>
                        <td class="col-value">${item.sponsoredFlag ? '⚠️ Yes' : 'No'}</td>
                        <td class="col-essential"><a href="${item.asinUrl}" target="_blank" rel="nofollow sponsored" class="buy-btn">Buy ↗</a></td>
                    </tr>`;
}

function updateHtml(products) {
    let html = fs.readFileSync(HTML_FILE, 'utf8');

    // JSON injection
    const js1 = '/* START_JSON_DATA */';
    const je1 = '/* END_JSON_DATA */';
    const i1 = html.indexOf(js1);
    const i2 = html.indexOf(je1);
    if (i1 === -1 || i2 === -1) {
        console.error('❌ Missing JSON markers in HTML');
        return;
    }
    html = html.slice(0, i1) +
        `${js1}\n        const PRODUCTS_DATA = ${JSON.stringify(products, null, 8)};\n        ${je1}` +
        html.slice(i2 + je1.length);

    // Static rows injection
    const rs = '<!-- START_TABLE_ROWS -->';
    const re = '<!-- END_TABLE_ROWS -->';
    const i3 = html.indexOf(rs);
    const i4 = html.indexOf(re);
    if (i3 === -1 || i4 === -1) {
        console.error('❌ Missing row markers in HTML');
        return;
    }
    const staticRows = products.map(buildStaticRow).join('\n');
    html = html.slice(0, i3) +
        `${rs}\n${staticRows}\n                    ${re}` +
        html.slice(i4 + re.length);

    // Pre-calculate stats for Googlebot
    const certified = products.filter(p => p.thirdPartyFlag).length;
    const avgTrust = products.length > 0 ? Math.round(products.reduce((s, p) => s + p.trustScore, 0) / products.length) : 0;
    const ppsArr = products.map(p => p.pricePerServing).filter(p => p > 0);
    const cheapest = ppsArr.length > 0 ? Math.min(...ppsArr).toFixed(2) : '0.00';
    const openLabel = products.length > 0 ? Math.round(products.filter(p => !p.proprietaryBlend).length / products.length * 100) : 0;

    html = html.replace(/(<span class="stat-val" id="stat-total">)[^<]*/, `$1${products.length}`);
    html = html.replace(/(<span class="stat-val" id="stat-certified">)[^<]*/, `$1${certified}`);
    html = html.replace(/(<span class="stat-val" id="stat-trust">)[^<]*/, `$1${avgTrust}`);
    html = html.replace(/(<span class="stat-val" id="stat-cheapest">)[^<]*/, `$1$${cheapest}`);
    html = html.replace(/(<span class="stat-val" id="stat-open">)[^<]*/, `$1${openLabel}%`);

    fs.writeFileSync(HTML_FILE, html);
    console.log(`💾 index.html updated (${products.length} products)`);
}

// ==========================================
// 11. MAIN
// ==========================================
async function main() {
    console.log(`\n🧪 Amazon Supplements Scraper`);
    console.log(`   Mode: ${IS_FULL ? 'FULL' : 'LIGHT'}`);
    console.log(`   Pages per query: ${MAX_PAGES}\n`);

    let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : [];
    const knownIds = new Set(db.map(p => p.id));
    console.log(`📦 DB: ${db.length} products loaded`);

    {
        for (const query of QUERIES) {
            for (let page = 1; page <= MAX_PAGES; page++) {
                const cacheKey = `${query.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_p${page}`;
                const url = `${SCRAPERAPI_SEARCH}?api_key=${SCRAPERAPI_KEY}&query=${encodeURIComponent(query)}&country=us&page=${page}`;

                try {
                    const data = await fetchWithCache(url, cacheKey);
                    const items = data.results || data.organic_results || data.items || [];
                    let added = 0;
                    for (const raw of items) {
                        const id = raw.asin || raw.product_id || raw.id;
                        if (!id || knownIds.has(id)) continue;
                        const normalized = normalizeAmazonItem(raw);
                        if (normalized.priceListed <= 0) continue;
                        knownIds.add(id);
                        db.push(normalized);
                        added++;
                    }
                    if (added > 0) console.log(`   ✅ "${query}" p${page}: +${added} new`);
                } catch (e) {
                    console.error(`   ⚠️ "${query}" p${page}: ${e.message}`);
                }
            }
        }
    }

    // Re-parse servings for all products (fixes stale data from old regex)
    let reParsed = 0;
    for (const p of db) {
        const freshServings = parseServings(p.title);
        if (freshServings !== p.servingsDeclared) {
            p.servingsDeclared = freshServings;
            p.servingsVerified = !!freshServings;
            p.pricePerServing = (freshServings && p.priceListed) ? Math.round((p.priceListed / freshServings) * 100) / 100 : null;
            reParsed++;
        }
    }
    if (reParsed > 0) console.log(`🔄 Re-parsed servings for ${reParsed} products`);

    // Re-enrich EPA/DHA for Fish Oil products missing omega data
    let omegaEnriched = 0;
    for (const p of db) {
        if (!p.category) p.category = detectCategory(p.title);
        if (p.category === 'Fish Oil' && !p.epaMg) {
            const omega = parseEpaDha(p.title);
            p.epaMg = omega.epa;
            p.dhaMg = omega.dha;
            p.totalOmega3Mg = omega.totalOmega3;
            p.pricePerGramOmega3 = (omega.totalOmega3 > 0 && p.servingsDeclared && p.priceListed)
                ? Math.round((p.priceListed / (omega.totalOmega3 * p.servingsDeclared / 1000)) * 100) / 100
                : null;
            if (omega.totalOmega3 > 0) omegaEnriched++;
        }
    }
    if (omegaEnriched > 0) console.log(`🐟 Enriched EPA/DHA for ${omegaEnriched} fish oil products`);

    // Re-enrich CFU for Probiotics missing data
    let cfuEnriched = 0;
    for (const p of db) {
        if (p.category === 'Probiotics' && !p.cfuBillions) {
            const cfu = parseCFU(p.title);
            p.cfuBillions = cfu;
            if (cfu > 0) cfuEnriched++;
        }
        if (p.category === 'Probiotics' && p.cfuBillions > 0 && !p.pricePer10bCFU && p.servingsDeclared && p.priceListed) {
            p.pricePer10bCFU = Math.round((p.priceListed / (p.cfuBillions * p.servingsDeclared / 10)) * 100) / 100;
        }
    }
    if (cfuEnriched > 0) console.log(`🦠 Enriched CFU for ${cfuEnriched} probiotic products`);

    // Re-enrich Berberine — mg, price, form, complex ingredients
    let berbEnriched = 0;
    for (const p of db) {
        if (p.category !== 'Berberine') continue;
        if (!p.berberineMg) {
            p.berberineMg = parseBerberineMg(p.title);
            if (p.berberineMg > 0) berbEnriched++;
        }
        if (p.berberineMg > 0 && !p.pricePer500mg && p.servingsDeclared && p.priceListed) {
            p.pricePer500mg = Math.round((p.priceListed / (p.berberineMg * p.servingsDeclared / 500)) * 100) / 100;
        }
        // Backfill form + complex (always re-parse — new fields)
        if (!p.berberineForm) p.berberineForm = parseBerberineForm(p.title);
        if (!p.complexIngredients || p.complexIngredients.length === 0) {
            p.complexIngredients = BERBERINE_COMPLEX_PATTERNS.filter(pt => pt.regex.test(p.title)).map(pt => pt.tag);
        }
    }
    if (berbEnriched > 0) console.log(`🌿 Enriched Berberine mg for ${berbEnriched} products`);

    // Compute scores
    computeAllScores(db);

    // Save DB
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    console.log(`\n💾 products-db.json saved (${db.length} products)`);

    // Inject into HTML
    if (fs.existsSync(HTML_FILE)) {
        updateHtml(db);
    } else {
        console.log('⚠️ index.html not found — skipping injection');
    }

    // Stats
    const cats = {};
    for (const p of db) {
        cats[p.category] = (cats[p.category] || 0) + 1;
    }
    console.log('\n📊 Categories:');
    for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${cat}: ${count}`);
    }

    const certified = db.filter(p => p.thirdPartyFlag).length;
    const avgTrust = db.length > 0 ? Math.round(db.reduce((s, p) => s + p.trustScore, 0) / db.length) : 0;
    console.log(`\n🏆 ${certified}/${db.length} third-party certified`);
    console.log(`📈 Average Trust Score: ${avgTrust}/100`);
    console.log(`\n🎉 Pipeline done!`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
