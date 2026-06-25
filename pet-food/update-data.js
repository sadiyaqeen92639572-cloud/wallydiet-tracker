const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CONFIGURATION & CREDENTIALS
// ==========================================
const SCRAPERAPI_KEY      = process.env.SCRAPER_API_KEY || '9e6091af4f7987d1f035fa0490980022';
const SCRAPERAPI_ENDPOINT_WALMART = 'https://api.scraperapi.com/structured/walmart/search';
const SCRAPERAPI_ENDPOINT_AMAZON  = 'https://api.scraperapi.com/structured/amazon/search';

const OXY_USER = process.env.OXY_USER || null;
const OXY_PASS = process.env.OXY_PASS || null;
const OXY_ENDPOINT = 'https://realtime.oxylabs.io/v1/queries';

const USE_OXYLABS = !!(OXY_USER && OXY_PASS);

const DB_FILE    = path.join(__dirname, 'products-db.json');
const HTML_FILE  = path.join(__dirname, 'index.html');
const CACHE_DIR  = path.join(__dirname, 'api-cache');
const CACHE_TTL_MS = 15 * 24 * 60 * 60 * 1000;

const MAX_PAGES = process.argv.includes('--full') ? 3 : 1;
const MOCK_MODE = process.argv.includes('--mock');

console.log(`🐾 Pet Food Value Tracker — Pipeline`);
console.log(`   Provider: ${USE_OXYLABS ? 'Oxylabs' : 'ScraperAPI'}`);
console.log(`   Mode: ${MOCK_MODE ? 'MOCK' : 'LIVE'} | Pages: ${MAX_PAGES}`);

// ==========================================
// 2. SEARCH QUERIES
// ==========================================
const QUERIES_WALMART = [
    'grain free dog food',
    'dry dog food',
    'wet dog food canned',
    'puppy food',
    'senior dog food',
    'salmon dog food',
    'lamb dog food',
    'chicken free dog food',
    'small breed dog food',
    'large breed dog food',
    'cat food dry',
    'cat food wet canned',
    'grain free cat food',
    'kitten food',
    'high protein dog food',
    'dog food sensitive stomach',
    'limited ingredient dog food',
];

const QUERIES_AMAZON = [
    'grain free dog food dry',
    'pea free dog food',
    'dog food no peas lentils',
    'novel protein dog food',
    'duck dog food',
    'venison dog food',
    'high protein cat food',
    'limited ingredient cat food',
];

// ==========================================
// 3. CATEGORY DETECTION
// ==========================================
const CATEGORY_PATTERNS = [
    { regex: /\b(kitten)\b/i, cat: 'Kitten Food' },
    { regex: /\b(puppy|pup)\b/i, cat: 'Puppy Food' },
    { regex: /\b(senior|mature|aging|7\+|11\+)\b/i, cat: 'Senior Food' },
    { regex: /\b(cat|feline)\b/i, cat: 'Cat Food' },
    { regex: /\b(wet|canned|pate|paté|stew|gravy|broth)\b/i, cat: 'Wet Food' },
    { regex: /\b(treat|biscuit|jerky|chew|dental)\b/i, cat: 'Treats' },
    { regex: /\b(topper|mixer|supplement)\b/i, cat: 'Toppers' },
    { regex: /\b(dog|canine)\b/i, cat: 'Dog Food Dry' },
];

function detectCategory(title) {
    const t = (title || '').toLowerCase();
    // Check for cat + wet combo
    if (/\b(cat|feline|kitten)\b/i.test(t) && /\b(wet|canned|pate|paté|stew)\b/i.test(t)) return 'Cat Food Wet';
    if (/\b(dog|canine|puppy)\b/i.test(t) && /\b(wet|canned|pate|paté|stew)\b/i.test(t)) return 'Dog Food Wet';
    for (const { regex, cat } of CATEGORY_PATTERNS) {
        if (regex.test(t)) return cat;
    }
    return 'Dog Food Dry';
}

// ==========================================
// 4. BREED SIZE DETECTION
// ==========================================
function detectBreedSize(title) {
    const t = (title || '').toLowerCase();
    if (/\b(small breed|toy breed|mini breed)\b/i.test(t)) return 'Small Breed';
    if (/\b(large breed|giant breed|big breed)\b/i.test(t)) return 'Large Breed';
    if (/\b(medium breed)\b/i.test(t)) return 'Medium Breed';
    if (/\b(all breed|all life|all size)\b/i.test(t)) return 'All Breeds';
    return null;
}

// ==========================================
// 5. PROTEIN SOURCE DETECTION
// ==========================================
const PROTEIN_PATTERNS = [
    { regex: /\b(salmon|wild.?caught salmon)\b/i, protein: 'Salmon' },
    { regex: /\b(whitefish|white fish|pollock|cod|haddock)\b/i, protein: 'Whitefish' },
    { regex: /\b(duck)\b/i, protein: 'Duck' },
    { regex: /\b(lamb)\b/i, protein: 'Lamb' },
    { regex: /\b(venison|deer)\b/i, protein: 'Venison' },
    { regex: /\b(turkey)\b/i, protein: 'Turkey' },
    { regex: /\b(pork|boar|wild boar)\b/i, protein: 'Pork/Boar' },
    { regex: /\b(bison|buffalo|water buffalo)\b/i, protein: 'Bison/Buffalo' },
    { regex: /\b(rabbit)\b/i, protein: 'Rabbit' },
    { regex: /\b(beef|steak)\b/i, protein: 'Beef' },
    { regex: /\b(chicken|poultry)\b/i, protein: 'Chicken' },
];

function detectProteinSource(title) {
    const t = (title || '').toLowerCase();
    const sources = [];
    for (const { regex, protein } of PROTEIN_PATTERNS) {
        if (regex.test(t)) sources.push(protein);
    }
    return sources.length > 0 ? sources : ['Unknown'];
}

function detectFirstIngredientType(title) {
    const proteins = detectProteinSource(title);
    if (proteins.length > 0 && proteins[0] !== 'Unknown') return 'Real Meat';
    return 'Unknown';
}

// ==========================================
// 6. DIET & HEALTH TAG DETECTION
// ==========================================
const DIET_TAG_PATTERNS = [
    { regex: /grain[- ]?free|no grain/i, tag: 'Grain-Free' },
    { regex: /pea[- ]?free|no peas/i, tag: 'Pea-Free' },
    { regex: /legume[- ]?free|no legume/i, tag: 'Legume-Free' },
    { regex: /whole grain|wholesome grain|with grain/i, tag: 'With Wholesome Grains' },
    { regex: /corn.{0,5}wheat.{0,5}soy[- ]?free|no corn.{0,5}wheat.{0,5}soy/i, tag: 'Corn, Wheat & Soy Free' },
    { regex: /chicken[- ]?free|no chicken/i, tag: 'Chicken-Free' },
    { regex: /beef[- ]?free|no beef/i, tag: 'Beef-Free' },
];

const HEALTH_TAG_PATTERNS = [
    { regex: /\bno\s*(?:artificial|added)\s*(?:color|colour|flavor|preservative)/i, tag: 'No Artificial Colors/Flavors' },
    { regex: /\bno\s*(?:BHA|BHT|ethoxyquin)/i, tag: 'No BHA/BHT' },
    { regex: /\breal\s*(?:meat|chicken|beef|salmon|lamb|duck|turkey|fish)\b/i, tag: 'Real Meat 1st' },
    { regex: /\bsensitive\s*(?:skin|stomach|digest)/i, tag: 'Sensitive Skin/Stomach' },
    { regex: /\bhigh\s*protein\b/i, tag: 'High Protein' },
    { regex: /\blimited\s*ingredient/i, tag: 'Limited Ingredient' },
    { regex: /\bweight\s*(?:management|control|healthy)\b/i, tag: 'Weight Management' },
    { regex: /\bjoint\s*(?:health|support)\b/i, tag: 'Joint Support' },
    { regex: /\bskin\s*(?:&|and)\s*coat\b/i, tag: 'Skin & Coat' },
    { regex: /\bdigestive\s*health\b/i, tag: 'Digestive Health' },
];

const EXTRA_TAG_PATTERNS = [
    { regex: /\borganic\b|usda organic/i, tag: 'Organic' },
    { regex: /\bnon[- ]?gmo\b/i, tag: 'Non-GMO' },
    { regex: /\bgluten[- ]?free\b/i, tag: 'Gluten-Free' },
    { regex: /\busa[- ]?made\b|\bmade in (?:the )?(?:usa|u\.s\.a?)\b/i, tag: 'Made in USA' },
    { regex: /\bnatural\b/i, tag: 'Natural' },
    { regex: /\bholistic\b/i, tag: 'Holistic' },
    { regex: /\bhuman[- ]?grade\b/i, tag: 'Human-Grade' },
    { regex: /\bfreeze[- ]?dried\b/i, tag: 'Freeze-Dried' },
    { regex: /\braw\b/i, tag: 'Raw' },
    { regex: /\bprobiotics?\b/i, tag: 'Probiotics' },
];

function detectDietTags(title) {
    return DIET_TAG_PATTERNS.filter(p => p.regex.test(title)).map(p => p.tag);
}

function detectHealthTags(title) {
    return HEALTH_TAG_PATTERNS.filter(p => p.regex.test(title)).map(p => p.tag);
}

function detectExtraTags(title) {
    return EXTRA_TAG_PATTERNS.filter(p => p.regex.test(title)).map(p => p.tag);
}

// ==========================================
// 7. WEIGHT PARSING (Critical — handles multi-pack)
// ==========================================
function parseWeightLbs(title) {
    const t = (title || '').toLowerCase();

    // Multi-pack wet food — all patterns:

    // Pattern A: count BEFORE oz — "12 x 5.5 oz", "Pack of 12, 13.2-oz cans", "24-Count 3oz"
    const multiA = t.match(/(?:pack\s*(?:of\s*)?|x\s*)?(\d+)\s*[-x×]\s*(\d+(?:\.\d+)?)\s*(?:oz|ounce)/i)
        || t.match(/(\d+)\s*(?:count|ct|pk|pack)\s*[,\s]*(\d+(?:\.\d+)?)\s*(?:oz|ounce)/i);
    if (multiA) {
        const count = parseInt(multiA[1]);
        const ozEach = parseFloat(multiA[2]);
        if (count > 1 && ozEach > 0) return (count * ozEach) / 16;
    }

    // Pattern B: "(12 pack) ... 13 oz can" — count in parens at start, oz later
    const multiParen = t.match(/\((\d+)\s*(?:pack|pk|ct|count)\)\s*.*?(\d+(?:\.\d+)?)\s*(?:oz|ounce)/i);
    if (multiParen) {
        const count = parseInt(multiParen[1]);
        const ozEach = parseFloat(multiParen[2]);
        if (count > 1 && ozEach > 0) return (count * ozEach) / 16;
    }

    // Pattern C: oz BEFORE count — "5.5 oz Cans 32 Pack", "13oz Can 12pk", "5.8 oz, 24 Pack"
    // Also handles "2.8 oz. Cup, 12 Count" (dot after oz) and "Split Trays"
    const multiC = t.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounce)s?\.?\s*(?:can|cup|pouch|tub|tray|split\s*tray)?s?\s*[,\s]+(\d+)\s*(?:count|ct|pack|pk)\b/i);
    if (multiC) {
        const ozEach = parseFloat(multiC[1]);
        const count = parseInt(multiC[2]);
        if (count > 1 && ozEach > 0) return (count * ozEach) / 16;
    }

    // Pattern D: "3 oz Cans (12 Count ...)" — oz then count in parens with possible extra text
    const multiD = t.match(/(\d+(?:\.\d+)?)\s*[-]?\s*(?:oz|ounce)s?\.?\s*(?:can|cup|pouch|tub|tray|split\s*tray)?s?\s*\((\d+)\s*(?:count|ct|pack|pk)/i);
    if (multiD) {
        const ozEach = parseFloat(multiD[1]);
        const count = parseInt(multiD[2]);
        if (count > 1 && ozEach > 0) return (count * ozEach) / 16;
    }
    // Single oz: "13.2 oz" or "5.5-Ounce"
    const singleOz = t.match(/(\d+(?:\.\d+)?)\s*[-]?\s*(?:oz|ounce)s?\b/i);

    // Pounds: "30 lb" or "28-Pound" or "15 lbs"
    const lbs = t.match(/(\d+(?:\.\d+)?)\s*[-]?\s*(?:lb|lbs|pound)s?\b/i);

    // Kg: "6.8 kg" or "13.6-Kilogram"
    const kg = t.match(/(\d+(?:\.\d+)?)\s*[-]?\s*(?:kg|kilogram)s?\b/i);

    if (lbs) return parseFloat(lbs[1]);
    if (kg) return parseFloat(kg[1]) * 2.20462;
    if (singleOz) return parseFloat(singleOz[1]) / 16;

    return null;
}

// ==========================================
// 8. PRICE PARSING
// ==========================================
function parsePrice(raw) {
    if (typeof raw === 'number') return raw;
    const m = String(raw || '').match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
}

// ==========================================
// 9. SCORE COMPUTATION
// ==========================================
function computeTrustScore(item) {
    let score = 50;
    if (item.firstIngredientType === 'Real Meat') score += 20;
    const allTags = [...item.dietTags, ...item.healthTags, ...item.extraTags];
    if (allTags.includes('No BHA/BHT') || allTags.includes('No Artificial Colors/Flavors')) score += 10;
    if (allTags.includes('Non-GMO')) score += 5;
    if (allTags.includes('Organic')) score += 5;
    if (allTags.includes('Made in USA')) score += 5;
    if (allTags.includes('Human-Grade')) score += 5;
    if (allTags.includes('Limited Ingredient')) score += 5;
    if (item.rating >= 4.5) score += 5;
    else if (item.rating >= 4.0) score += 2;
    return Math.min(100, Math.max(0, score));
}

function computeValueScore(item, allProducts) {
    if (!item.pricePerLb || item.pricePerLb <= 0) return 0;
    const sameCat = allProducts.filter(p => p.category === item.category && p.pricePerLb > 0);
    if (sameCat.length === 0) return 50;
    const prices = sameCat.map(p => p.pricePerLb).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const ratio = item.pricePerLb / median;
    let score = Math.round(100 - (ratio - 0.5) * 60);
    if (item.rating >= 4.5) score += 10;
    else if (item.rating >= 4.0) score += 5;
    if (item.trustScore >= 70) score += 5;
    return Math.min(100, Math.max(0, score));
}

// ==========================================
// 9b. PRICE MATCHING — Cross-store fuzzy matching
// ==========================================
function normalizeForMatch(title) {
    return (title || '').toLowerCase()
        .replace(/[®™©]/g, '')
        .replace(/\b(dry|dog|cat|food|pet|premium|formula|recipe|adult|all\s*breed|natural)\b/g, '')
        .replace(/\b\d+(\.\d+)?\s*(lb|lbs|pound|oz|ounce|kg|count|ct|pack)\b/gi, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenSimilarity(a, b) {
    const tokA = new Set(a.split(/\s+/).filter(t => t.length > 2));
    const tokB = new Set(b.split(/\s+/).filter(t => t.length > 2));
    if (tokA.size === 0 || tokB.size === 0) return 0;
    let intersection = 0;
    for (const t of tokA) { if (tokB.has(t)) intersection++; }
    return intersection / Math.min(tokA.size, tokB.size);
}

function getSpecies(item) {
    const t = (item.title || '').toLowerCase();
    const c = (item.category || '').toLowerCase();
    if (c.includes('cat') || c.includes('kitten') || /\bcat\b|\bkitten\b|\bfeline\b/i.test(t)) return 'cat';
    return 'dog';
}

function matchProducts(products) {
    const walmart = products.filter(p => p.source === 'walmart');
    const amazon = products.filter(p => p.source === 'amazon');
    let matched = 0;

    // Clear old matches
    for (const p of products) {
        delete p.rivalId; delete p.rivalPrice; delete p.rivalSource;
        delete p.rivalUrl; delete p.savings; delete p.cheaperAt; delete p.matchScore;
    }

    for (const wp of walmart) {
        const wpNorm = normalizeForMatch(wp.title);
        const wpBrand = (wp.brand || '').toLowerCase();
        const wpSpecies = getSpecies(wp);
        let bestMatch = null;
        let bestScore = 0;

        for (const ap of amazon) {
            if (ap.rivalId) continue;
            const apBrand = (ap.brand || '').toLowerCase();
            if (wpBrand && apBrand && wpBrand !== apBrand) continue;

            // Species must match
            if (getSpecies(ap) !== wpSpecies) continue;

            // Weight must be similar (within 15%)
            if (wp.weightLbs && ap.weightLbs) {
                const ratio = wp.weightLbs / ap.weightLbs;
                if (ratio < 0.85 || ratio > 1.15) continue;
            } else {
                continue; // skip if either missing weight
            }

            // Price ratio sanity — reject if price differs by >2.5x
            const priceRatio = Math.max(wp.price, ap.price) / Math.min(wp.price, ap.price);
            if (priceRatio > 2.5) continue;

            const apNorm = normalizeForMatch(ap.title);
            const sim = tokenSimilarity(wpNorm, apNorm);

            if (sim > bestScore && sim >= 0.65) {
                bestScore = sim;
                bestMatch = ap;
            }
        }

        if (bestMatch) {
            const cheaper = wp.price <= bestMatch.price ? 'walmart' : 'amazon';
            const savings = Math.abs(wp.price - bestMatch.price);

            wp.rivalId = bestMatch.id;
            wp.rivalPrice = bestMatch.price;
            wp.rivalSource = 'amazon';
            wp.rivalUrl = bestMatch.url;
            wp.savings = Math.round(savings * 100) / 100;
            wp.cheaperAt = cheaper;
            wp.matchScore = Math.round(bestScore * 100);

            bestMatch.rivalId = wp.id;
            bestMatch.rivalPrice = wp.price;
            bestMatch.rivalSource = 'walmart';
            bestMatch.rivalUrl = wp.url;
            bestMatch.savings = Math.round(savings * 100) / 100;
            bestMatch.cheaperAt = cheaper;
            bestMatch.matchScore = Math.round(bestScore * 100);

            matched++;
        }
    }

    console.log(`🔗 Price matched: ${matched} products across Walmart ↔ Amazon`);
    return matched;
}

// ==========================================
// 10. NORMALIZE ITEM
// ==========================================
function normalizeItem(raw, source) {
    const id = String(raw.id || raw.product_id || raw.asin || '');
    if (!id) return null;

    const title = raw.title || raw.name || '';
    const price = parsePrice(raw.price || raw.price_string || raw.min_price);
    if (price <= 0) return null;

    const weightLbs = parseWeightLbs(title);
    let pricePerLb = weightLbs && weightLbs > 0 ? Math.round((price / weightLbs) * 100) / 100 : null;
    // Sanity: $/lb > $30 = almost certainly a multi-pack with missing count
    if (pricePerLb && pricePerLb > 30) pricePerLb = null;

    const proteinSources = detectProteinSource(title);
    const dietTags = detectDietTags(title);
    const healthTags = detectHealthTags(title);
    const extraTags = detectExtraTags(title);
    const category = detectCategory(title);
    const breedSize = detectBreedSize(title);
    const firstIngredientType = detectFirstIngredientType(title);

    const rating = parseFloat(raw.rating || raw.stars || raw.average_rating || 0);
    const reviews = parseInt(raw.reviews_count || raw.ratings_total || raw.total_reviews || raw.num_reviews || 0);

    const image = raw.image || raw.image_url || raw.thumbnail || raw.main_image || null;
    const url = raw.url || raw.product_url || raw.link || '#';

    const brand = raw.brand || extractBrand(title);

    return {
        id,
        title,
        brand,
        price,
        weightLbs,
        pricePerLb,
        proteinSources,
        firstIngredientType,
        dietTags,
        healthTags,
        extraTags,
        category,
        breedSize,
        rating: Math.round(rating * 10) / 10,
        reviews,
        image,
        url,
        source,
        trustScore: 0,
        valueScore: 0,
        dateAdded: new Date().toISOString().split('T')[0],
    };
}

function extractBrand(title) {
    const known = [
        'Purina', 'Blue Buffalo', 'Iams', 'Pedigree', 'Royal Canin', 'Hills',
        "Hill's", 'Taste of the Wild', 'Orijen', 'Acana', 'Merrick', 'Nutro',
        'Rachael Ray', 'Canidae', 'Wellness', 'Natural Balance', 'Fromm',
        'Instinct', 'Nulo', 'Open Farm', "Stella & Chewy's", 'Zignature',
        'Diamond', 'Victor', 'Sportmix', 'Kirkland', 'Great Value',
        'American Journey', 'Whole Earth Farms', 'Nature\'s Recipe',
        'Cesar', 'Fancy Feast', 'Friskies', 'Meow Mix', '9Lives',
        'Sheba', 'Tiki Cat', 'Weruva', "Newman's Own",
    ];
    for (const b of known) {
        if (title.toLowerCase().includes(b.toLowerCase())) return b;
    }
    const first2 = title.split(/[,\-–—]|\d/)[0].trim().split(/\s+/).slice(0, 3).join(' ');
    return first2 || 'Unknown';
}

// ==========================================
// 11. CACHE
// ==========================================
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function getCached(key) {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age > CACHE_TTL_MS) return null;
    console.log(`   💾 Cache HIT: ${key}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function setCache(key, data) {
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

// ==========================================
// 12. API FETCH (unified)
// ==========================================
async function fetchFromApi(query, source, page = 1) {
    if (USE_OXYLABS) {
        const oxySource = source === 'amazon' ? 'amazon_search' : 'walmart_search';
        const credentials = Buffer.from(`${OXY_USER}:${OXY_PASS}`).toString('base64');
        const response = await fetch(OXY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${credentials}` },
            body: JSON.stringify({ source: oxySource, query, parse: true, start_page: page, pages: 1 }),
        });
        if (!response.ok) throw new Error(`Oxylabs HTTP ${response.status}: ${await response.text()}`);
        const raw = await response.json();
        return { items: raw.results?.[0]?.content?.results?.organic || [] };
    } else {
        const endpoint = source === 'amazon' ? SCRAPERAPI_ENDPOINT_AMAZON : SCRAPERAPI_ENDPOINT_WALMART;
        const url = `${endpoint}?api_key=${SCRAPERAPI_KEY}&query=${encodeURIComponent(query)}&page=${page}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`ScraperAPI HTTP ${response.status}`);
        const data = await response.json();
        // ScraperAPI Amazon returns { results: [] }, Walmart returns { items: [] }
        if (!data.items && data.results) {
            data.items = data.results;
        }
        return data;
    }
}

// ==========================================
// 13. MOCK DATA
// ==========================================
function getMockData() {
    return [
        { id: 'mock-001', title: 'Taste of the Wild High Prairie Grain-Free Dry Dog Food with Real Buffalo, 28 lb bag', price: 48.98, rating: 4.7, reviews_count: 12450, image: 'https://i5.walmartimages.com/placeholder1.jpg', url: 'https://www.walmart.com/ip/mock-001', brand: 'Taste of the Wild' },
        { id: 'mock-002', title: 'Blue Buffalo Life Protection Chicken and Brown Rice Dry Dog Food, 30 lb', price: 54.98, rating: 4.6, reviews_count: 9800, image: 'https://i5.walmartimages.com/placeholder2.jpg', url: 'https://www.walmart.com/ip/mock-002', brand: 'Blue Buffalo' },
        { id: 'mock-003', title: 'Purina Pro Plan Sensitive Skin & Stomach Salmon & Rice Dry Dog Food, 30 lb', price: 62.48, rating: 4.7, reviews_count: 15200, image: 'https://i5.walmartimages.com/placeholder3.jpg', url: 'https://www.walmart.com/ip/mock-003', brand: 'Purina' },
        { id: 'mock-004', title: 'Orijen Six Fish Grain-Free Pea-Free Dry Dog Food, 23.5 lb', price: 89.99, rating: 4.8, reviews_count: 4300, image: 'https://i5.walmartimages.com/placeholder4.jpg', url: 'https://www.walmart.com/ip/mock-004', brand: 'Orijen' },
        { id: 'mock-005', title: 'Diamond Naturals Lamb Meal & Rice Dry Dog Food, 40 lb', price: 39.98, rating: 4.5, reviews_count: 8900, image: 'https://i5.walmartimages.com/placeholder5.jpg', url: 'https://www.walmart.com/ip/mock-005', brand: 'Diamond' },
        { id: 'mock-006', title: 'Rachael Ray Nutrish Real Chicken & Veggies Dry Dog Food No Artificial Colors, 40 lb', price: 35.98, rating: 4.4, reviews_count: 7600, image: 'https://i5.walmartimages.com/placeholder6.jpg', url: 'https://www.walmart.com/ip/mock-006', brand: 'Rachael Ray' },
        { id: 'mock-007', title: 'Pedigree Complete Nutrition Adult Dry Dog Food, 50 lb', price: 29.98, rating: 4.3, reviews_count: 22000, image: 'https://i5.walmartimages.com/placeholder7.jpg', url: 'https://www.walmart.com/ip/mock-007', brand: 'Pedigree' },
        { id: 'mock-008', title: 'Merrick Grain-Free Real Texas Beef & Sweet Potato Dry Dog Food, 22 lb', price: 59.98, rating: 4.6, reviews_count: 5100, image: 'https://i5.walmartimages.com/placeholder8.jpg', url: 'https://www.walmart.com/ip/mock-008', brand: 'Merrick' },
        { id: 'mock-009', title: 'Canidae Pure Limited Ingredient Duck & Sweet Potato Grain-Free Dry Dog Food, 21 lb', price: 56.99, rating: 4.5, reviews_count: 3400, image: 'https://i5.walmartimages.com/placeholder9.jpg', url: 'https://www.walmart.com/ip/mock-009', brand: 'Canidae' },
        { id: 'mock-010', title: 'Iams ProActive Health Adult Large Breed Dry Dog Food Chicken, 30 lb', price: 34.98, rating: 4.5, reviews_count: 11500, image: 'https://i5.walmartimages.com/placeholder10.jpg', url: 'https://www.walmart.com/ip/mock-010', brand: 'Iams' },
        { id: 'mock-011', title: 'Fancy Feast Classic Pate Seafood Feast Wet Cat Food, Pack of 24 3-oz cans', price: 18.48, rating: 4.7, reviews_count: 19200, image: 'https://i5.walmartimages.com/placeholder11.jpg', url: 'https://www.walmart.com/ip/mock-011', brand: 'Fancy Feast' },
        { id: 'mock-012', title: 'Wellness Complete Health Grain-Free Turkey & Salmon Cat Food Dry, 11.5 lb', price: 38.99, rating: 4.5, reviews_count: 2800, image: 'https://i5.walmartimages.com/placeholder12.jpg', url: 'https://www.walmart.com/ip/mock-012', brand: 'Wellness' },
        { id: 'mock-013', title: 'Victor Hi-Pro Plus High Protein Dry Dog Food, 50 lb', price: 49.99, rating: 4.7, reviews_count: 6700, image: 'https://i5.walmartimages.com/placeholder13.jpg', url: 'https://www.walmart.com/ip/mock-013', brand: 'Victor' },
        { id: 'mock-014', title: 'Instinct Raw Boost Grain-Free Chicken Dry Dog Food with Freeze-Dried Raw, 20 lb', price: 64.99, rating: 4.6, reviews_count: 4100, image: 'https://i5.walmartimages.com/placeholder14.jpg', url: 'https://www.walmart.com/ip/mock-014', brand: 'Instinct' },
        { id: 'mock-015', title: 'Natural Balance Limited Ingredient Lamb & Brown Rice Dry Dog Food, 26 lb', price: 49.98, rating: 4.4, reviews_count: 3600, image: 'https://i5.walmartimages.com/placeholder15.jpg', url: 'https://www.walmart.com/ip/mock-015', brand: 'Natural Balance' },
        { id: 'mock-016', title: 'Nulo Freestyle Grain-Free Salmon & Peas Senior Dry Dog Food, 24 lb', price: 58.99, rating: 4.6, reviews_count: 2200, image: 'https://i5.walmartimages.com/placeholder16.jpg', url: 'https://www.walmart.com/ip/mock-016', brand: 'Nulo' },
        { id: 'mock-017', title: 'Cesar Filets in Gravy Wet Dog Food Variety Pack, 24 x 3.5 oz', price: 22.98, rating: 4.5, reviews_count: 14800, image: 'https://i5.walmartimages.com/placeholder17.jpg', url: 'https://www.walmart.com/ip/mock-017', brand: 'Cesar' },
        { id: 'mock-018', title: 'Zignature Duck Formula Limited Ingredient Grain-Free Pea-Free Dry Dog Food, 25 lb', price: 72.99, rating: 4.7, reviews_count: 1800, image: 'https://i5.walmartimages.com/placeholder18.jpg', url: 'https://www.walmart.com/ip/mock-018', brand: 'Zignature' },
        { id: 'mock-019', title: "Hill's Science Diet Adult Chicken & Barley Recipe Dry Dog Food, 35 lb", price: 57.99, rating: 4.6, reviews_count: 13200, image: 'https://i5.walmartimages.com/placeholder19.jpg', url: 'https://www.walmart.com/ip/mock-019', brand: "Hill's" },
        { id: 'mock-020', title: 'Tiki Cat Luau Variety Pack Grain-Free Wet Cat Food, 12 x 2.8 oz', price: 16.99, rating: 4.6, reviews_count: 5400, image: 'https://i5.walmartimages.com/placeholder20.jpg', url: 'https://www.walmart.com/ip/mock-020', brand: 'Tiki Cat' },
    ];
}

// ==========================================
// 14. BUILD STATIC ROW
// ==========================================
function buildBuyCell(item) {
    const primaryLabel = item.source === 'amazon' ? 'Amazon' : 'Walmart';
    const primaryBtn = `<a href="${item.url}" target="_blank" rel="nofollow sponsored" class="buy-btn buy-${item.source}">${primaryLabel} $${item.price.toFixed(2)} ↗</a>`;

    if (!item.rivalId || !item.rivalUrl) return primaryBtn;

    const rivalLabel = item.rivalSource === 'amazon' ? 'Amazon' : 'Walmart';
    const rivalBtn = `<a href="${item.rivalUrl}" target="_blank" rel="nofollow sponsored" class="buy-btn buy-${item.rivalSource} buy-rival">${rivalLabel} $${item.rivalPrice.toFixed(2)} ↗</a>`;

    const savingsBadge = item.savings > 0
        ? `<span class="savings-badge ${item.cheaperAt === item.source ? 'savings-here' : 'savings-rival'}">🔥 Save $${item.savings.toFixed(2)} at ${item.cheaperAt === item.source ? primaryLabel : rivalLabel}</span>`
        : '';

    return `<div class="dual-buy">${primaryBtn}${rivalBtn}${savingsBadge}</div>`;
}

function buildStaticRow(item) {
    const dietBadges = (item.dietTags || []).map(t => `<span class="badge badge-diet">${t}</span>`).join('');
    const healthBadges = (item.healthTags || []).map(t => `<span class="badge badge-health">${t}</span>`).join('');
    const extraBadges = (item.extraTags || []).map(t => `<span class="badge badge-extra">${t}</span>`).join('');
    const proteinBadges = (item.proteinSources || []).map(t => `<span class="badge badge-protein">${t}</span>`).join('');

    const pricePerLbDisplay = item.pricePerLb ? `$${item.pricePerLb.toFixed(2)}/lb` : '—';
    const weightDisplay = item.weightLbs ? `${item.weightLbs.toFixed(1)} lb` : '—';
    const ratingDisplay = item.rating > 0 ? item.rating.toFixed(1) : '—';
    const reviewsDisplay = item.reviews > 0 ? item.reviews.toLocaleString() : '—';

    const trustClass = item.trustScore >= 70 ? 'score-high' : item.trustScore >= 40 ? 'score-mid' : 'score-low';
    const valueClass = item.valueScore >= 70 ? 'score-high' : item.valueScore >= 40 ? 'score-mid' : 'score-low';

    const meatBadge = item.firstIngredientType === 'Real Meat'
        ? '<span class="badge badge-ok">Real Meat 1st</span>'
        : '<span class="badge badge-none">Unknown</span>';

    const breedBadge = item.breedSize ? `<span class="badge badge-extra">${item.breedSize}</span>` : '';
    const catBadge = `<span class="cat-badge">${item.category}</span>`;

    const imgSrc = item.image || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22%3E%3Crect fill=%22%23111520%22 width=%2244%22 height=%2244%22/%3E%3Ctext x=%2222%22 y=%2226%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2218%22%3E🐾%3C/text%3E%3C/svg%3E';

    return `                    <tr data-id="${item.id}" data-category="${item.category}" data-price-per-lb="${item.pricePerLb || 999}" data-rating="${item.rating}" data-trust="${item.trustScore}" data-value="${item.valueScore}" data-weight="${item.weightLbs || 0}">
                        <td class="col-essential col-img"><img src="${imgSrc}" alt="${(item.brand || '').replace(/"/g, '&quot;')}" loading="lazy" class="product-thumb"></td>
                        <td class="col-essential col-name"><div class="product-name">${item.title}</div><div class="product-brand">${item.brand || ''}</div></td>
                        <td class="col-essential" data-sort="${item.price}">$${item.price.toFixed(2)}</td>
                        <td class="col-essential">${weightDisplay}</td>
                        <td class="col-essential col-metric" data-sort="${item.pricePerLb || 999}"><span class="badge badge-free">${pricePerLbDisplay}</span></td>
                        <td class="col-essential">${catBadge}${breedBadge}</td>
                        <td class="col-essential" data-sort="${item.rating}">${ratingDisplay} <span class="review-count">(${reviewsDisplay})</span></td>
                        <td class="col-ingredients">${proteinBadges}</td>
                        <td class="col-ingredients">${meatBadge}</td>
                        <td class="col-ingredients">${dietBadges}</td>
                        <td class="col-health">${healthBadges}</td>
                        <td class="col-health">${extraBadges}</td>
                        <td class="col-value"><span class="${trustClass}">${item.trustScore}</span></td>
                        <td class="col-value"><span class="${valueClass}">${item.valueScore}</span></td>
                        <td class="col-essential col-buy">${buildBuyCell(item)}</td>
                    </tr>`;
}

// ==========================================
// 15. UPDATE HTML
// ==========================================
function updateHtml(products) {
    let html = fs.readFileSync(HTML_FILE, 'utf8');

    // Inject JSON data
    const js1 = '/* START_JSON_DATA */';
    const je1 = '/* END_JSON_DATA */';
    const i1 = html.indexOf(js1);
    const i2 = html.indexOf(je1);
    if (i1 >= 0 && i2 >= 0) {
        html = html.slice(0, i1) +
            `${js1}\n        const PRODUCTS_DATA = ${JSON.stringify(products, null, 8)};\n        ${je1}` +
            html.slice(i2 + je1.length);
    }

    // Inject static rows
    const rs = '<!-- START_TABLE_ROWS -->';
    const re = '<!-- END_TABLE_ROWS -->';
    const r1 = html.indexOf(rs);
    const r2 = html.indexOf(re);
    if (r1 >= 0 && r2 >= 0) {
        html = html.slice(0, r1) +
            `${rs}\n${products.map(buildStaticRow).join('\n')}\n                    ${re}` +
            html.slice(r2 + re.length);
    }

    // Update stats bar with real values
    const prices = products.map(p => p.pricePerLb).filter(p => p > 0);
    const statTotal = products.length;
    const statLowest = prices.length > 0 ? Math.min(...prices).toFixed(2) : '0.00';
    const statAvg = prices.length > 0 ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : '0.00';
    const statBrands = new Set(products.map(p => p.brand)).size;

    html = html.replace(/(<span class="stat-val" id="stat-total">)[^<]*/, `$1${statTotal}`);
    html = html.replace(/(<span class="stat-val" id="stat-lowest">)[^<]*/, `$1$${statLowest}/lb`);
    html = html.replace(/(<span class="stat-val" id="stat-avg">)[^<]*/, `$1$${statAvg}/lb`);
    html = html.replace(/(<span class="stat-val" id="stat-brands">)[^<]*/, `$1${statBrands}`);

    fs.writeFileSync(HTML_FILE, html);
    console.log(`💾 index.html updated (${products.length} products, ${statBrands} brands)`);
}

// ==========================================
// 16. MAIN PIPELINE
// ==========================================
async function main() {
    let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : [];
    const knownIds = new Set(db.map(p => p.id));
    console.log(`📦 DB loaded: ${db.length} products`);

    if (MOCK_MODE) {
        console.log('🧪 MOCK MODE — injecting test data');
        const mockItems = getMockData();
        let added = 0;
        for (const raw of mockItems) {
            if (knownIds.has(raw.id)) continue;
            const item = normalizeItem(raw, 'walmart');
            if (!item) continue;
            knownIds.add(item.id);
            db.push(item);
            added++;
        }
        console.log(`   ✅ +${added} mock products`);
    } else {
        // Walmart queries
        for (const query of QUERIES_WALMART) {
            for (let page = 1; page <= MAX_PAGES; page++) {
                const cacheKey = `walmart_${query.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_p${page}`;
                let items;
                const cached = getCached(cacheKey);
                if (cached) {
                    items = cached.items || [];
                } else {
                    try {
                        console.log(`   📡 Walmart: "${query}" p${page}`);
                        const data = await fetchFromApi(query, 'walmart', page);
                        items = data.items || [];
                        setCache(cacheKey, data);
                    } catch (e) {
                        console.error(`   ⚠️ Error: ${e.message}`);
                        continue;
                    }
                }
                let added = 0;
                for (const raw of items) {
                    const item = normalizeItem(raw, 'walmart');
                    if (!item || knownIds.has(item.id)) continue;
                    knownIds.add(item.id);
                    db.push(item);
                    added++;
                }
                if (added > 0) console.log(`   ✅ +${added} from "${query}" p${page}`);
            }
        }

        // Amazon queries
        for (const query of QUERIES_AMAZON) {
            for (let page = 1; page <= MAX_PAGES; page++) {
                const cacheKey = `amazon_${query.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_p${page}`;
                let items;
                const cached = getCached(cacheKey);
                if (cached) {
                    items = cached.items || [];
                } else {
                    try {
                        console.log(`   📡 Amazon: "${query}" p${page}`);
                        const data = await fetchFromApi(query, 'amazon', page);
                        items = data.items || [];
                        setCache(cacheKey, data);
                    } catch (e) {
                        console.error(`   ⚠️ Error: ${e.message}`);
                        continue;
                    }
                }
                let added = 0;
                for (const raw of items) {
                    const item = normalizeItem(raw, 'amazon');
                    if (!item || knownIds.has(item.id)) continue;
                    knownIds.add(item.id);
                    db.push(item);
                    added++;
                }
                if (added > 0) console.log(`   ✅ +${added} from "${query}" p${page}`);
            }
        }
    }

    // Re-enrichment pass
    let enriched = 0;
    for (const p of db) {
        let changed = false;
        if (!p.category) { p.category = detectCategory(p.title); changed = true; }
        if (!p.breedSize) { p.breedSize = detectBreedSize(p.title); changed = true; }
        if (!p.dietTags || p.dietTags.length === 0) {
            const dt = detectDietTags(p.title);
            if (dt.length > 0) { p.dietTags = dt; changed = true; }
        }
        if (!p.healthTags || p.healthTags.length === 0) {
            const ht = detectHealthTags(p.title);
            if (ht.length > 0) { p.healthTags = ht; changed = true; }
        }
        if (!p.extraTags || p.extraTags.length === 0) {
            const et = detectExtraTags(p.title);
            if (et.length > 0) { p.extraTags = et; changed = true; }
        }
        if (!p.proteinSources || p.proteinSources.length === 0) {
            p.proteinSources = detectProteinSource(p.title);
            changed = true;
        }
        if (!p.firstIngredientType) {
            p.firstIngredientType = detectFirstIngredientType(p.title);
            changed = true;
        }
        // Reparse weight always (multi-pack fix)
        const freshWeight = parseWeightLbs(p.title);
        if (freshWeight && freshWeight !== p.weightLbs) {
            p.weightLbs = freshWeight;
            let ppl = Math.round((p.price / freshWeight) * 100) / 100;
            p.pricePerLb = ppl > 30 ? null : ppl;
            changed = true;
        }
        // Cap existing outliers
        if (p.pricePerLb && p.pricePerLb > 30) { p.pricePerLb = null; changed = true; }
        if (changed) enriched++;
    }

    // Compute scores (needs full product list)
    for (const p of db) {
        p.trustScore = computeTrustScore(p);
    }
    for (const p of db) {
        p.valueScore = computeValueScore(p, db);
    }

    if (enriched > 0) console.log(`🔄 Re-enriched ${enriched} products`);

    // Price matching across stores
    matchProducts(db);

    // Save DB
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    console.log(`💾 products-db.json saved (${db.length} products)`);

    // Update HTML
    updateHtml(db);

    console.log(`\n🎉 Pipeline complete! Total: ${db.length} products`);
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
