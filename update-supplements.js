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
 *   ScraperAPI Amazon Search → supplements-db.json → supplements.html injection
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CONFIGURATION
// ==========================================
const SCRAPERAPI_KEY = process.env.SCRAPER_API_KEY || '9e6091af4f7987d1f035fa0490980022';
const SCRAPERAPI_SEARCH = 'https://api.scraperapi.com/structured/amazon/search';
const SCRAPERAPI_PRODUCT = 'https://api.scraperapi.com/structured/amazon/product';

const DB_FILE = path.join(__dirname, 'supplements-db.json');
const HTML_FILE = path.join(__dirname, 'supplements.html');
const CACHE_DIR = path.join(__dirname, 'supplements-cache');
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
    // Multivitamin
    'third party tested multivitamin',
    'NSF certified multivitamin',
    'clean multivitamin no fillers',
    'gluten free multivitamin USP verified',
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
    { regex: /transparent\s*label/i, tag: 'Transparent Label' },
    { regex: /clinically\s*(studied|dosed|proven)/i, tag: 'Clinically Studied' },
    { regex: /lab[\s-]?tested/i, tag: 'Lab Tested' },
    { regex: /grass[\s-]?fed/i, tag: 'Grass-Fed' },
    { regex: /cold[\s-]?process/i, tag: 'Cold-Processed' },
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

// ==========================================
// 4. SERVING/SIZE PARSING
// ==========================================
function parseServings(title) {
    const m = title.match(/(\d+)\s*serv/i);
    return m ? parseInt(m[1]) : null;
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
    score += product.matchedKeywords.length > 0 ? 30 : 0;
    score += product.thirdPartyFlag ? 25 : 0;
    if (product.pricePerServing && categoryMedianPrice) {
        score += product.pricePerServing < categoryMedianPrice ? 20 : 0;
    }
    score += product.freeFromTags.length >= 2 ? 15 : 0;
    if (categoryMedianReviews) {
        score += (product.reviewsCount || 0) < categoryMedianReviews ? 10 : 0;
    }
    return Math.round(score);
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
// 7. MOCK DATA
// ==========================================
function generateMockData() {
    const brands = [
        'Optimum Nutrition', 'Transparent Labs', 'Momentous', 'Thorne',
        'Garden of Life', 'NOW Sports', 'Legion Athletics', 'Nutricost',
        'Jacked Factory', 'Cellucor', 'Kaged', 'Dymatize',
        'Nature Made', 'Ritual', 'LMNT', 'Liquid IV',
        'Muscle Feast', 'Naked Nutrition', 'BulkSupplements', 'Promix',
    ];

    const products = [
        // Whey
        { brand: 'Optimum Nutrition', title: 'Gold Standard 100% Whey Protein Powder, Naturally Flavored, Gluten Free, 4.8 lb', cat: 'Whey', price: 64.99, servings: 68, rating: 4.7, reviews: 145230, asin: 'B000QSNYGI', weight: '4.8 lb', certs: ['Informed-Choice'], freeFrom: ['Gluten-Free'], fillers: [], proprietary: false, claims: [] },
        { brand: 'Transparent Labs', title: '100% Grass-Fed Whey Protein Isolate, 28 Servings, No Artificial Sweeteners, Non-GMO, Gluten Free', cat: 'Whey', price: 59.99, servings: 28, rating: 4.5, reviews: 8432, asin: 'B0BXYZ1234', weight: '1.98 lb', certs: ['Third-Party Tested'], freeFrom: ['Gluten-Free', 'Non-GMO', 'No Artificial'], fillers: [], proprietary: false, claims: ['Transparent Label', 'Grass-Fed'] },
        { brand: 'Momentous', title: 'Grass-Fed Whey Protein, NSF Certified for Sport, 24 Servings, No Fillers', cat: 'Whey', price: 55.95, servings: 24, rating: 4.6, reviews: 3210, asin: 'B0CABC5678', weight: '1.65 lb', certs: ['NSF'], freeFrom: ['No Artificial', 'Gluten-Free'], fillers: [], proprietary: false, claims: ['Grass-Fed', 'Lab Tested'] },
        { brand: 'Thorne', title: 'Whey Protein Isolate, NSF Certified, 30 Servings, Chocolate, cGMP', cat: 'Whey', price: 52.00, servings: 30, rating: 4.4, reviews: 5678, asin: 'B07XYZ9012', weight: '1.87 lb', certs: ['NSF', 'cGMP'], freeFrom: ['Gluten-Free', 'Soy-Free'], fillers: [], proprietary: false, claims: ['Lab Tested'] },
        { brand: 'Naked Nutrition', title: 'Naked Whey 5LB - Only 1 Ingredient, Grass Fed, No Artificial Sweeteners, Non-GMO, Gluten Free', cat: 'Whey', price: 94.99, servings: 76, rating: 4.5, reviews: 42150, asin: 'B00NBGZ3HA', weight: '5 lb', certs: ['Third-Party Tested'], freeFrom: ['Gluten-Free', 'Non-GMO', 'No Artificial', 'Soy-Free'], fillers: [], proprietary: false, claims: ['Transparent Label', 'Grass-Fed'] },
        { brand: 'Muscle Feast', title: 'Grass Fed Whey Protein Isolate, All Natural, Hormone Free, No Maltodextrin, Gluten Free, 2lb', cat: 'Whey', price: 39.99, servings: 27, rating: 4.4, reviews: 6230, asin: 'B00ABCWHEY', weight: '2 lb', certs: ['Third-Party Tested'], freeFrom: ['Gluten-Free', 'Non-GMO'], fillers: [], proprietary: false, claims: ['Grass-Fed'] },

        // Pre-Workout
        { brand: 'Transparent Labs', title: 'BULK Pre-Workout, Clinically Dosed, No Artificial Sweeteners, Stevia, 30 Servings', cat: 'Pre-Workout', price: 49.99, servings: 30, rating: 4.5, reviews: 12430, asin: 'B0DEF12345', weight: '17.5 oz', certs: ['Third-Party Tested'], freeFrom: ['Sucralose-Free', 'No Artificial', 'Stevia'], fillers: [], proprietary: false, claims: ['Transparent Label', 'Clinically Studied'] },
        { brand: 'Legion Athletics', title: 'Pulse Pre-Workout, Clinically Dosed, No Artificial Sweeteners, Stevia, 21 Servings', cat: 'Pre-Workout', price: 44.99, servings: 21, rating: 4.4, reviews: 18760, asin: 'B0GHI67890', weight: '12.2 oz', certs: ['Third-Party Tested'], freeFrom: ['Sucralose-Free', 'No Artificial', 'Stevia'], fillers: [], proprietary: false, claims: ['Transparent Label', 'Clinically Studied'] },
        { brand: 'Kaged', title: 'Pre-Kaged Sport, Informed Sport Certified, 20 Servings, Third Party Tested', cat: 'Pre-Workout', price: 29.99, servings: 20, rating: 4.3, reviews: 4567, asin: 'B0JKL11223', weight: '9.3 oz', certs: ['Informed-Sport', 'Third-Party Tested'], freeFrom: ['Gluten-Free'], fillers: [], proprietary: false, claims: ['Clinically Studied'] },
        { brand: 'Jacked Factory', title: 'Nitrosurge Pre Workout, No Proprietary Blends, Sucralose Free, 30 Servings', cat: 'Pre-Workout', price: 34.99, servings: 30, rating: 4.3, reviews: 25600, asin: 'B0MNO44556', weight: '8.9 oz', certs: [], freeFrom: ['Sucralose-Free'], fillers: [], proprietary: false, claims: ['Transparent Label'] },

        // Creatine
        { brand: 'Thorne', title: 'Creatine Monohydrate, NSF Certified for Sport, 90 Servings, cGMP', cat: 'Creatine', price: 35.00, servings: 90, rating: 4.7, reviews: 9870, asin: 'B0PCREAT01', weight: '16 oz', certs: ['NSF', 'cGMP'], freeFrom: ['Gluten-Free'], fillers: [], proprietary: false, claims: ['Lab Tested'] },
        { brand: 'Momentous', title: 'Creatine Monohydrate, NSF Certified, Creapure, 60 Servings', cat: 'Creatine', price: 44.95, servings: 60, rating: 4.6, reviews: 4320, asin: 'B0QCREAT02', weight: '10.6 oz', certs: ['NSF'], freeFrom: ['Gluten-Free', 'Non-GMO'], fillers: [], proprietary: false, claims: ['Lab Tested'] },
        { brand: 'Nutricost', title: 'Creatine Monohydrate Micronized, 500g, 100 Servings, Third Party Tested, Gluten Free', cat: 'Creatine', price: 15.95, servings: 100, rating: 4.6, reviews: 67800, asin: 'B0RCREAT03', weight: '17.6 oz', certs: ['Third-Party Tested'], freeFrom: ['Gluten-Free', 'Non-GMO'], fillers: [], proprietary: false, claims: [] },
        { brand: 'BulkSupplements', title: 'Creatine Monohydrate Powder, 1 kg, 200 Servings, Lab Tested, No Fillers', cat: 'Creatine', price: 19.96, servings: 200, rating: 4.6, reviews: 89500, asin: 'B0SCREAT04', weight: '35.2 oz', certs: ['Third-Party Tested'], freeFrom: ['Gluten-Free', 'Soy-Free', 'Non-GMO'], fillers: [], proprietary: false, claims: ['Lab Tested'] },

        // Electrolytes
        { brand: 'LMNT', title: 'LMNT Electrolyte Drink Mix, No Sugar, No Artificial Ingredients, Keto, 30 Packets', cat: 'Electrolytes', price: 45.00, servings: 30, rating: 4.7, reviews: 38900, asin: 'B0TELEC01', weight: '7.2 oz', certs: [], freeFrom: ['Gluten-Free', 'No Artificial', 'Keto-Friendly'], fillers: [], proprietary: false, claims: [] },
        { brand: 'Liquid IV', title: 'Hydration Multiplier Electrolyte Drink Mix, Non-GMO, 16 Packets', cat: 'Electrolytes', price: 23.99, servings: 16, rating: 4.6, reviews: 125000, asin: 'B0UELEC02', weight: '5.6 oz', certs: [], freeFrom: ['Non-GMO', 'Gluten-Free'], fillers: [], proprietary: true, claims: [] },
        { brand: 'Promix', title: 'Electrolyte Powder, No Sugar, Third Party Tested, 90 Servings, Unflavored', cat: 'Electrolytes', price: 24.95, servings: 90, rating: 4.4, reviews: 2100, asin: 'B0VELEC03', weight: '12.7 oz', certs: ['Third-Party Tested'], freeFrom: ['Gluten-Free', 'No Artificial', 'Vegan'], fillers: [], proprietary: false, claims: ['Lab Tested'] },

        // Multivitamin
        { brand: 'Thorne', title: 'Basic Nutrients 2/Day, NSF Certified, Multivitamin, 60 Capsules, cGMP', cat: 'Multivitamin', price: 29.00, servings: 30, rating: 4.6, reviews: 11200, asin: 'B0WMULTI01', weight: '4.2 oz', certs: ['NSF', 'cGMP'], freeFrom: ['Gluten-Free', 'Soy-Free'], fillers: [], proprietary: false, claims: [] },
        { brand: 'Nature Made', title: 'Multivitamin Complete, USP Verified, 250 Tablets', cat: 'Multivitamin', price: 16.59, servings: 250, rating: 4.7, reviews: 98700, asin: 'B0XMULTI02', weight: '8.1 oz', certs: ['USP'], freeFrom: ['Gluten-Free'], fillers: [], proprietary: false, claims: [] },
        { brand: 'Ritual', title: 'Essential for Men 18+ Multivitamin, Third Party Tested, Vegan, 30 Day Supply', cat: 'Multivitamin', price: 35.00, servings: 30, rating: 4.3, reviews: 5670, asin: 'B0YMULTI03', weight: '3.5 oz', certs: ['Third-Party Tested', 'USP'], freeFrom: ['Gluten-Free', 'Vegan', 'Non-GMO', 'No Artificial'], fillers: [], proprietary: false, claims: ['Transparent Label'] },
        { brand: 'Garden of Life', title: 'Vitamin Code Raw One for Men, Whole Food Multivitamin, 75 Capsules, Non-GMO, Gluten Free', cat: 'Multivitamin', price: 32.49, servings: 75, rating: 4.5, reviews: 24300, asin: 'B0ZMULTI04', weight: '5.8 oz', certs: ['Third-Party Tested'], freeFrom: ['Gluten-Free', 'Non-GMO', 'Vegan'], fillers: [], proprietary: false, claims: [] },
    ];

    return products.map((p, i) => ({
        id: p.asin,
        scrapeDate: new Date().toISOString().split('T')[0],
        marketplace: 'Amazon US',
        brand: p.brand,
        title: p.title,
        asinUrl: `https://www.amazon.com/dp/${p.asin}`,
        category: p.cat,
        priceListed: p.price,
        shippingInfo: 'Prime',
        servingsDeclared: p.servings,
        totalWeight: p.weight,
        pricePerServing: p.servings > 0 ? Math.round((p.price / p.servings) * 100) / 100 : null,
        servingsVerified: p.servings > 0,
        thirdPartyCerts: p.certs,
        thirdPartyFlag: p.certs.length > 0,
        freeFromTags: p.freeFrom,
        proprietaryBlend: p.proprietary,
        fillers: p.fillers,
        additivesFlag: p.fillers.length > 0,
        claims: p.claims,
        reviewsCount: p.reviews,
        avgRating: p.rating,
        sponsoredFlag: false,
        matchedKeywords: [],
        trustScore: 0,
        gapScore: 0,
    }));
}

// ==========================================
// 8. NORMALIZE RAW AMAZON ITEM
// ==========================================
function normalizeAmazonItem(raw) {
    const title = raw.title || raw.name || '';
    const price = parsePrice(raw.price || raw.price_string || raw.buybox_price);
    const servings = parseServings(title);
    const weight = parseWeight(title);
    const tags = detectTags(title + ' ' + (raw.description || '') + ' ' + (raw.feature_bullets || []).join(' '));

    return {
        id: raw.asin || raw.product_id || raw.id,
        scrapeDate: new Date().toISOString().split('T')[0],
        marketplace: 'Amazon US',
        brand: raw.brand || extractBrand(title),
        title: title,
        asinUrl: raw.url || raw.link || `https://www.amazon.com/dp/${raw.asin}`,
        category: detectCategory(title),
        priceListed: price,
        shippingInfo: raw.is_prime ? 'Prime' : (raw.shipping || 'Standard'),
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
        reviewsCount: raw.reviews_count || raw.ratings_total || parseInt(raw.reviews) || 0,
        avgRating: parseFloat(raw.rating || raw.stars || 0),
        sponsoredFlag: !!raw.is_sponsored,
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

    return `                    <tr data-category="${item.category}" data-brand="${item.brand}" data-id="${item.id}">
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
                        <td class="col-ingredients">${claimBadges || '—'}</td>
                        <td class="col-trust">${certBadges || '<span class="badge badge-none">None</span>'}</td>
                        <td class="col-trust"><span class="${trustClass}">${item.trustScore}</span></td>
                        <td class="col-seo"><span class="${gapClass}">${item.gapScore}</span></td>
                        <td class="col-seo">${item.sponsoredFlag ? '⚠️ Yes' : 'No'}</td>
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

    fs.writeFileSync(HTML_FILE, html);
    console.log(`💾 supplements.html updated (${products.length} products)`);
}

// ==========================================
// 11. MAIN
// ==========================================
async function main() {
    console.log(`\n🧪 Amazon Supplements Scraper`);
    console.log(`   Mode: ${IS_MOCK ? 'MOCK' : IS_FULL ? 'FULL' : 'LIGHT'}`);
    console.log(`   Pages per query: ${MAX_PAGES}\n`);

    let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : [];
    const knownIds = new Set(db.map(p => p.id));
    console.log(`📦 DB: ${db.length} products loaded`);

    if (IS_MOCK) {
        console.log('\n🎭 Generating mock data...');
        const mockProducts = generateMockData();
        let added = 0;
        for (const p of mockProducts) {
            if (!knownIds.has(p.id)) {
                knownIds.add(p.id);
                db.push(p);
                added++;
            }
        }
        console.log(`   ✅ +${added} mock products`);
    } else {
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

    // Compute scores
    computeAllScores(db);

    // Save DB
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    console.log(`\n💾 supplements-db.json saved (${db.length} products)`);

    // Inject into HTML
    if (fs.existsSync(HTML_FILE)) {
        updateHtml(db);
    } else {
        console.log('⚠️ supplements.html not found — skipping injection');
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
