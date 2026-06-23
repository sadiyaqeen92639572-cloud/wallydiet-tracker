/**
 * Walmart pSEO Price-Per-Ounce Automation Script
 * File: update-data.js
 *
 * MODES:
 *   node update-data.js          → Daily light update (page 1 only, new products only)
 *   node update-data.js --full   → Massive initial scrape (42 queries × 3 pages)
 *
 * DEDUPLICATION:
 *   products-db.json  → Master database of all unique products
 *   Walmart item IDs  → Used as the unique deduplication key
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CONFIGURATION & CREDENTIALS
// ==========================================
const SCRAPERAPI_KEY = '9e6091af4f7987d1f035fa0490980022';
const SCRAPERAPI_ENDPOINT = 'https://api.scraperapi.com/structured/walmart/search';

const HTML_FILE_PATH = path.join(__dirname, 'index.html');
const DB_FILE_PATH   = path.join(__dirname, 'products-db.json');

// Run mode: --full = big initial scrape, default = daily light update
const IS_FULL_SCRAPE = process.argv.includes('--full');
const MAX_PAGES      = IS_FULL_SCRAPE ? 3 : 1;

// 42 diverse queries spanning Gluten-Free, Keto, Vegan niches
const QUERIES = [
    // ── Gluten-Free ──────────────────────────────────
    'gluten free bread',
    'gluten free pasta',
    'gluten free flour',
    'gluten free cookies',
    'gluten free crackers',
    'gluten free cereal',
    'gluten free pizza',
    'gluten free snacks',
    'gluten free cake mix',
    'gluten free pancake mix',
    'gluten free granola',
    'gluten free oats',
    'gluten free chips',
    'gluten free pretzels',
    'gluten free waffles',
    // ── Keto ─────────────────────────────────────────
    'keto snacks',
    'keto bars',
    'keto protein powder',
    'keto nuts seeds',
    'keto cheese crisps',
    'keto bread',
    'keto chocolate',
    'keto coffee creamer',
    'keto jerky',
    'keto electrolytes',
    'low carb tortillas',
    'keto sweetener',
    // ── Vegan ─────────────────────────────────────────
    'vegan protein powder',
    'vegan cheese',
    'vegan butter',
    'vegan milk alternative',
    'plant based meat',
    'vegan snacks',
    'vegan chocolate',
    'vegan yogurt',
    'vegan jerky',
    'vegan protein bars',
    'plant based burger',
    'vegan ice cream',
    // ── Crossover / Specialty ─────────────────────────
    'dairy free foods',
    'organic plant protein',
    'sugar free candy',
    'paleo snacks',
];

// Define dietary keywords for categorization mapping
const DIET_PATTERNS = {
    'Gluten-Free': /gluten[- ]free|sans gluten/i,
    'Keto': /keto|ketogenic|low[- ]carb/i,
    'Vegan': /vegan|plant[- ]based/i
};

// ==========================================
// 2. ROBUST SIZE PARSER & CONVERSION ENGINE
// ==========================================
/**
 * Standardizes weight/size units to Ounces (oz).
 * Extracts size from product names like "Cheez-It Crackers, 9 oz" or "12 Count, 1.5 oz each".
 *
 * Strategy:
 *  1. If "X oz/g/lb each" pattern → qty × unit weight
 *  2. Otherwise → take the LAST weight measurement in the string (= total package weight)
 *
 * @param {string} sizeStr - Raw size string or full product name from API
 * @returns {number|null} Standardized size in Ounces, or null if parsing fails.
 */
function parseSizeToOz(sizeStr) {
    if (!sizeStr) return null;

    const toOz = (val, unit) => {
        if (unit.startsWith('g') || unit.startsWith('gram')) return val * 0.035274;
        if (unit.startsWith('lb') || unit.startsWith('pound')) return val * 16.0;
        if (unit.startsWith('kg') || unit.startsWith('kilo')) return val * 35.274;
        return val; // oz / fl oz
    };

    // Normalize string: lowercase, remove non-essential whitespace
    const str = sizeStr.toLowerCase().trim();
    
    // Pattern 1: Multi-pack with per-unit weight: "12 ct, 1.5 oz each" / "6 pack (2.5oz per bag)"
    // Only multiply count × unit when "each / per / every" qualifier is present
    const eachMatch = str.match(/(\d+)\s*(?:count|pack|ct|pcs|pk|x)\b[^a-z]*?(\d+(?:\.\d+)?)\s*(oz|ounce|g|gram|lb|pound|kg|fl\s*oz)\s*(?:each|per|every)/i)
                   || str.match(/(\d+(?:\.\d+)?)\s*(oz|ounce|g|gram|lb|pound|kg)\s*(?:each|per|every)[^a-z]*?(\d+)\s*(?:count|pack|ct|pcs|pk)/i);
    if (eachMatch) {
        const qty = parseFloat(eachMatch[1]);
        const val = parseFloat(eachMatch[2]);
        const unit = eachMatch[3];
        return parseFloat((qty * toOz(val, unit)).toFixed(2));
    }

    // Pattern 2: "X oz / X g / X lb / X kg" — collect ALL matches, return the LAST one
    // The last weight in a product title = total package weight
    // e.g. "Cheez-It Crackers, 9 oz" → 9oz
    // e.g. "Kraft Mac & Cheese, 12 Count Box, 6 oz" → 6oz (not 12 × 6)
    const unitRegex = /(\d+(?:\.\d+)?)\s*(fl\s*oz|ounce[s]?|oz|gram[s]?|kg|kilo[s]?|lb[s]?|pound[s]?)/gi;
    const allMatches = [...str.matchAll(unitRegex)];
    if (allMatches.length > 0) {
        const last = allMatches[allMatches.length - 1];
        const val = parseFloat(last[1]);
        const unit = last[2].replace(/\s+/, '');
        const result = toOz(val, unit);
        // Sanity check: reject implausible values (< 0.1 oz or > 500 oz = ~31 lbs)
        if (result >= 0.1 && result <= 500) {
            return parseFloat(result.toFixed(2));
        }
    }

    return null;
}

// ==========================================
// 3. MOCK BRIGHT DATA RESPONSE GENERATOR
// ==========================================
// This mock data is triggered automatically if the credentials placeholder is unchanged,
// guaranteeing a working out-of-the-box local developer experience.
const MOCK_API_RESPONSE = [
    {
        "id": "wm-gv-af-v2",
        "name": "Great Value Gluten-Free Almond Flour (Keto)",
        "brand": "Great Value",
        "price": 6.88,
        "size": "16 oz",
        "url": "https://www.walmart.com/ip/Great-Value-Almond-Flour-16-oz/55401920"
    },
    {
        "id": "wm-gv-cf-v2",
        "name": "Great Value Organic Coconut Flour, Gluten-Free & Keto (Vegan)",
        "brand": "Great Value",
        "price": 4.79,
        "size": "16 oz",
        "url": "https://www.walmart.com/ip/Great-Value-Organic-Coconut-Flour-16-oz/55401923"
    },
    {
        "id": "wm-gv-brp-v2",
        "name": "Great Value Gluten-Free Brown Rice Penne Pasta",
        "brand": "Great Value",
        "price": 2.18,
        "size": "16 oz",
        "url": "https://www.walmart.com/ip/Great-Value-Gluten-Free-Brown-Rice-Penne/12345"
    },
    {
        "id": "wm-banza-penne-v2",
        "name": "Banza Gluten-Free Chickpea Penne Pasta (Vegan)",
        "brand": "Banza",
        "price": 2.89,
        "size": "8 oz",
        "url": "https://www.walmart.com/ip/Banza-Chickpea-Penne-Pasta/23456"
    },
    {
        "id": "wm-ka-m4m-v2",
        "name": "King Arthur Gluten-Free Measure for Measure Flour",
        "brand": "King Arthur",
        "price": 8.79,
        "size": "3 lb",
        "url": "https://www.walmart.com/ip/King-Arthur-Gluten-Free-Flour/34567"
    },
    {
        "id": "wm-sm-crackers-v2",
        "name": "Simple Mills Gluten-Free Almond Flour Sea Salt Crackers (Vegan)",
        "brand": "Simple Mills",
        "price": 4.69,
        "size": "4.25 oz",
        "url": "https://www.walmart.com/ip/Simple-Mills-Almond-Flour-Crackers/45678"
    },
    {
        "id": "wm-brm-oats-v2",
        "name": "Bob's Red Mill Gluten-Free Organic Rolled Oats (Vegan)",
        "brand": "Bob's Red Mill",
        "price": 6.29,
        "size": "32 oz",
        "url": "https://www.walmart.com/ip/Bobs-Red-Mill-Gluten-Free-Oats/56789"
    },
    {
        "id": "wm-siete-tortillas-v2",
        "name": "Siete Family Foods Grain Free Gluten-Free Almond Flour Tortillas (Keto & Vegan)",
        "brand": "Siete",
        "price": 7.49,
        "size": "7 oz",
        "url": "https://www.walmart.com/ip/Siete-Almond-Flour-Tortillas/67890"
    },
    {
        "id": "wm-whisps-cheese-v2",
        "name": "Whisps Gluten-Free Parmesan Cheese Crisps Keto Snack",
        "brand": "Whisps",
        "price": 6.19,
        "size": "5.7 oz",
        "url": "https://www.walmart.com/ip/Whisps-Parmesan-Cheese-Crisps/78901"
    },
    {
        "id": "wm-cauli-pizza-v2",
        "name": "Caulipower Gluten-Free Cauliflower Pizza Crusts (2-Pack)",
        "brand": "Caulipower",
        "price": 6.49,
        "size": "11 oz",
        "url": "https://www.walmart.com/ip/Caulipower-Pizza-Crusts/89012"
    },
    {
        "id": "wm-quest-bars-v2",
        "name": "Quest Nutrition Gluten-Free & Keto Protein Bars, 4-ct",
        "brand": "Quest",
        "price": 8.49,
        "size": "8.4 oz",
        "url": "https://www.walmart.com/ip/Quest-Protein-Bars-Cookie-Dough/90123"
    },
    {
        "id": "wm-lilys-chips-v2",
        "name": "Lily's Gluten-Free Dark Chocolate Baking Chips (Keto & Vegan)",
        "brand": "Lily's",
        "price": 5.99,
        "size": "9 oz",
        "url": "https://www.walmart.com/ip/Lilys-Dark-Chocolate-Baking-Chips/99012"
    },
    {
        "id": "wm-beyond-burger-v2",
        "name": "Beyond Meat Beyond Burger Plant-Based Patties (Gluten-Free & Vegan)",
        "brand": "Beyond Meat",
        "price": 5.49,
        "size": "226 g",
        "url": "https://www.walmart.com/ip/Beyond-Meat-Beyond-Burger/99013"
    },
    {
        "id": "wm-silk-milk-v2",
        "name": "Silk Unsweetened Organic Almondmilk, Gluten-Free & Vegan",
        "brand": "Silk",
        "price": 3.69,
        "size": "64 fl oz",
        "url": "https://www.walmart.com/ip/Silk-Organic-Almond-Milk/99014"
    },
    {
        "id": "wm-rebel-icecream-v2",
        "name": "Rebel Gluten-Free Triple Chocolate Keto Pint Ice Cream",
        "brand": "Rebel",
        "price": 5.49,
        "size": "16 oz",
        "url": "https://www.walmart.com/ip/Rebel-Keto-Ice-Cream/99015"
    },
    {
        "id": "wm-primal-mayo-v2",
        "name": "Primal Kitchen Avocado Oil Mayo, Gluten-Free & Keto-Friendly",
        "brand": "Primal Kitchen",
        "price": 7.19,
        "size": "12 oz",
        "url": "https://www.walmart.com/ip/Primal-Kitchen-Avocado-Oil-Mayo/99016"
    },
    {
        "id": "wm-amys-lentil-v2",
        "name": "Amy's Organic Soups Gluten Free Lentil (Vegan)",
        "brand": "Amy's",
        "price": 2.99,
        "size": "411 g",
        "url": "https://www.walmart.com/ip/Amys-Organic-Lentil-Soup/99017"
    },
    {
        "id": "wm-larabar-pb-v2",
        "name": "Larabar Peanut Butter Cookie Gluten Free Bars (Vegan), 6-ct",
        "brand": "Larabar",
        "price": 6.49,
        "size": "9.6 oz",
        "url": "https://www.walmart.com/ip/Larabar-Peanut-Butter-Cookie/99018"
    },
    {
        "id": "wm-jovial-penne-v2",
        "name": "Jovial Brown Rice Penne Gluten-Free",
        "brand": "Jovial",
        "price": 3.99,
        "size": "12 oz",
        "url": "https://www.walmart.com/ip/Jovial-Brown-Rice-Penne/99019"
    },
    {
        "id": "wm-orgain-powder-v2",
        "name": "Orgain Organic Gluten-Free Plant-Based Protein Powder (Vegan)",
        "brand": "Orgain",
        "price": 28.49,
        "size": "2 lb",
        "url": "https://www.walmart.com/ip/Orgain-Organic-Protein-Powder/99020"
    }
];

// ==========================================
// 4. DATA PROCESSING & INGESTION
// ==========================================
/**
 * Ingests, normalizes, and filters raw items from Bright Data Walmart API.
 */
function processWalmartData(rawItems) {
    const processedItems = [];
    
    for (const item of rawItems) {
        // Resolve field mappings flexibly (handling api modifications)
        const id = item.id || `wm-gen-${Math.random().toString(36).substr(2, 9)}`;
        let product_name = item.name || item.product_name || item.title || 'Unknown Product';
        
        // Ensure first letter is capitalized
        if (product_name) {
            product_name = product_name.charAt(0).toUpperCase() + product_name.slice(1);
        }
        
        let brand = item.brand || item.manufacturer || 'Generic';
        
        // Fix for bad brand data like "(12"
        if (brand.startsWith('(') || brand.length < 2) {
            const match = product_name.match(/(?:\([^)]+\)\s*)?([A-Z][a-zA-Z0-9-']+)/);
            if (match && match[1]) {
                brand = match[1];
            } else {
                brand = 'Generic';
            }
        }
        
        // Resolve price
        let price = 0.00;
        if (typeof item.price === 'number') {
            price = item.price;
        } else if (item.price && typeof item.price.value === 'number') {
            price = item.price.value;
        } else if (item.price_amount) {
            price = parseFloat(item.price_amount);
        }
        
        const sizeStr = item.size || item.weight || item.package_size || item.name || '';
        const raw_url = item.url || item.product_url || '#';
        let image = item.image || item.image_url || item.thumbnail || '';
        
        // Ask for high-res images from Walmart CDN if possible
        if (image.includes('odnHeight=')) {
            image = image.replace(/odnHeight=\d+/, 'odnHeight=400').replace(/odnWidth=\d+/, 'odnWidth=400');
        } else if (image.includes('?')) {
            image += '&odnHeight=400&odnWidth=400';
        } else if (image !== '') {
            image += '?odnHeight=400&odnWidth=400';
        }
        
        let rating = 0;
        let reviews = 0;
        if (typeof item.rating === 'object' && item.rating !== null) {
            rating = parseFloat(item.rating.average_rating) || 0;
            reviews = parseInt(item.rating.number_of_reviews) || 0;
        } else {
            rating = parseFloat(item.rating) || 0;
            reviews = parseInt(item.reviews || item.review_count) || 0;
        }
        
        // Add Walmart affiliate parameters if needed, otherwise output safely
        const walmart_affiliate_url = raw_url;
        
        // Standardize size to ounces
        const size_oz = parseSizeToOz(sizeStr);
        if (!size_oz || size_oz <= 0 || price <= 0) {
            console.warn(`[Skipping] Invalid size or price for item: "${product_name}" (Price: $${price}, Size: "${sizeStr}")`);
            continue;
        }
        
        // Dynamic Unit Price Calculation
        const price_per_oz = parseFloat((price / size_oz).toFixed(2));
        
        // Dietary categorization mapping
        const diet_tags = [];
        for (const [tag, regex] of Object.entries(DIET_PATTERNS)) {
            if (regex.test(product_name) || (item.tags && item.tags.some(t => regex.test(t)))) {
                diet_tags.push(tag);
            }
        }
        
        // Fallback: If no diet category detected, default to Gluten-Free (most common in our dataset)
        if (diet_tags.length === 0) {
            diet_tags.push('Gluten-Free');
        }
        
        processedItems.push({
            id,
            product_name,
            brand,
            diet_tags,
            price,
            size_oz,
            price_per_oz,
            walmart_affiliate_url,
            image,
            rating,
            reviews
        });
    }
    
    return processedItems;
}

// ==========================================
// 5. HTML GENERATION & INJECTION ENGINE
// ==========================================
/**
 * Pre-renders table rows into static HTML strings.
 * Ensures Googlebot can index the product database upon first load without running JavaScript.
 * 
 * @param {Array} products - Ingested products array
 * @returns {string} Fully rendered HTML string for tbody injection
 */
function buildStaticTableRows(products) {
    let html = '';
    
    products.forEach((item, index) => {
        // Safe HTML characters escaping helper
        const escape = (str) => String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
            
        // Mid-Table Native Ad Block Insertion (inserted after 10th row)
        if (index === 10) {
            html += `
                    <!-- Mid-Table Native Ad Inserted After 10th row -->
                    <tr class="table-ad-row" data-ad-row="true">
                        <td colspan="7">
                            <div class="native-ad-box">
                                AdSense Placement - Responsive Banner
                            </div>
                        </td>
                    </tr>\n`;
        }

        const tagsHTML = item.diet_tags.map(tag => {
            const tagClass = tag.toLowerCase() === 'gluten-free' ? 'gf' : tag.toLowerCase() === 'keto' ? 'keto' : 'vegan';
            return `<span class="diet-tag ${tagClass}">${escape(tag)}</span>`;
        }).join('\n                            ');

        html += `                    <tr data-id="${escape(item.id)}">
                        <td class="col-brand">${escape(item.brand)}</td>
                        <td class="col-name">
                            <div class="product-info-wrapper">
                                ${item.image ? `<img src="${escape(item.image)}" alt="${escape(item.product_name)}" class="product-image" loading="lazy">` : ''}
                                <div class="product-details">
                                    <span>${escape(item.product_name)}</span>
                                    ${item.rating ? `<div class="product-rating" data-tooltip="${item.reviews} reviews">⭐ ${item.rating.toFixed(1)} <span class="reviews-count">(${item.reviews})</span></div>` : ''}
                                </div>
                            </div>
                        </td>
                        <td class="col-tags">
                            ${tagsHTML}
                        </td>
                        <td class="col-size">${item.size_oz.toFixed(1)} oz</td>
                        <td class="col-price">$${item.price.toFixed(2)}</td>
                        <td class="col-price-oz">$${item.price_per_oz.toFixed(2)}/oz</td>
                        <td>
                            <a class="buy-btn" href="${escape(item.walmart_affiliate_url)}" target="_blank" rel="nofollow sponsored">
                                Buy <svg viewBox="0 0 24 24"><path d="M5 21h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2zm2-8h10v2H7v-2zm0-4h10v2H7V9zm0-4h10v2H7V5z"/></svg>
                            </a>
                        </td>
                    </tr>\n`;
    });
    
    return html.trimRight();
}

/**
 * Reads, updates, and saves index.html
 */
function updateHtmlFile(processedProducts) {
    if (!fs.existsSync(HTML_FILE_PATH)) {
        throw new Error(`Frontend HTML file not found at ${HTML_FILE_PATH}. Build the foundation first!`);
    }

    let htmlContent = fs.readFileSync(HTML_FILE_PATH, 'utf8');

    // 1. Inject JSON array inside JS script block
    const startJsonMarker = '/* START_JSON_DATA */';
    const endJsonMarker = '/* END_JSON_DATA */';
    
    const jsonStartIndex = htmlContent.indexOf(startJsonMarker);
    const jsonEndIndex = htmlContent.indexOf(endJsonMarker);
    
    if (jsonStartIndex === -1 || jsonEndIndex === -1) {
        throw new Error('Could not find JS database placeholders in index.html! Ensure /* START_JSON_DATA */ and /* END_JSON_DATA */ comments exist.');
    }
    
    const formattedJsonStr = JSON.stringify(processedProducts, null, 12); // format cleanly to match indent
    const finalJsonBlock = `${startJsonMarker}\n        const PRODUCTS_DATA = ${formattedJsonStr.trim()};\n        ${endJsonMarker}`;

    htmlContent = 
        htmlContent.slice(0, jsonStartIndex) + 
        finalJsonBlock + 
        htmlContent.slice(jsonEndIndex + endJsonMarker.length);

    // 2. Inject Pre-rendered Table Rows in HTML DOM
    const startRowsMarker = '<!-- START_TABLE_ROWS -->';
    const endRowsMarker = '<!-- END_TABLE_ROWS -->';
    
    const rowsStartIndex = htmlContent.indexOf(startRowsMarker);
    const rowsEndIndex = htmlContent.indexOf(endRowsMarker);
    
    if (rowsStartIndex === -1 || rowsEndIndex === -1) {
        throw new Error('Could not find HTML Table rows placeholders in index.html! Ensure <!-- START_TABLE_ROWS --> and <!-- END_TABLE_ROWS --> exist.');
    }
    
    const staticRowsHtml = buildStaticTableRows(processedProducts);
    const finalRowsBlock = `${startRowsMarker}\n${staticRowsHtml}\n                    ${endRowsMarker}`;
    
    htmlContent = 
        htmlContent.slice(0, rowsStartIndex) + 
        finalRowsBlock + 
        htmlContent.slice(rowsEndIndex + endRowsMarker.length);
        
    // 3. Save atomic update back to file
    fs.writeFileSync(HTML_FILE_PATH, htmlContent, 'utf8');
}

// ==========================================
// 6. DATABASE HELPERS (deduplication)
// ==========================================

/** Load master product DB from disk, return { products[], knownIds Set }. */
function loadDatabase() {
    if (!fs.existsSync(DB_FILE_PATH)) {
        console.log('📂 No existing products-db.json found. Starting fresh.');
        return { products: [], knownIds: new Set() };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(DB_FILE_PATH, 'utf8'));
        const products = Array.isArray(raw) ? raw : [];
        const knownIds = new Set(products.map(p => p.id));
        console.log(`📂 Loaded existing DB: ${products.length} products, ${knownIds.size} unique IDs.`);
        return { products, knownIds };
    } catch (e) {
        console.error('⚠️  products-db.json is corrupted. Starting fresh.');
        return { products: [], knownIds: new Set() };
    }
}

/** Atomic save: write to .tmp first, then rename to avoid data loss. */
function saveDatabase(products) {
    const tmpPath = DB_FILE_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(products, null, 2), 'utf8');
    fs.renameSync(tmpPath, DB_FILE_PATH);
    console.log(`💾 products-db.json saved → ${products.length} total unique products.`);
}

// ==========================================
// 7. SCRIPT ORCHESTRATOR / RUN METHOD
// ==========================================
async function main() {
    console.log('==================================================');
    console.log(`🔄 Walmart pSEO Tracker — ${IS_FULL_SCRAPE ? '🚀 FULL SCRAPE MODE' : '⚡ Daily Update Mode'}`);
    console.log(`   Queries: ${QUERIES.length} | Pages per query: ${MAX_PAGES}`);
    console.log('==================================================');

    try {
        // ── Step 1: Load existing database ──────────────────
        const { products: existingProducts, knownIds } = loadDatabase();
        let currentProducts = [...existingProducts];
        const initialCount = currentProducts.length;

        // ── Step 2: Fetch from ScraperAPI incrementally ─────
        if (SCRAPERAPI_KEY === 'YOUR_API_KEY_HERE') {
            console.log('⚠️  Mock mode — using MOCK_API_RESPONSE.');
            const processed = processWalmartData(MOCK_API_RESPONSE);
            let newCount = 0;
            for (const p of processed) {
                if (!knownIds.has(p.id)) {
                    knownIds.add(p.id);
                    currentProducts.push(p);
                    newCount++;
                }
            }
            if (newCount > 0) {
                saveDatabase(currentProducts);
                updateHtmlFile(currentProducts);
            }
        } else {
            console.log(`\n📡 Connecting to ScraperAPI Walmart Endpoint...\n`);
            let totalApiCalls = 0;
            let totalNewCount = 0;

            for (const query of QUERIES) {
                let queryRawItems = [];
                for (let page = 1; page <= MAX_PAGES; page++) {
                    const url = `${SCRAPERAPI_ENDPOINT}?api_key=${SCRAPERAPI_KEY}&query=${encodeURIComponent(query)}&page=${page}`;
                    totalApiCalls++;

                    const cacheDir = path.join(__dirname, 'api-cache');
                    if (!fs.existsSync(cacheDir)) {
                        fs.mkdirSync(cacheDir, { recursive: true });
                    }
                    const safeQuery = query.toLowerCase().replace(/[^a-z0-9]/gi, '_');
                    const cacheFile = path.join(cacheDir, `${safeQuery}_p${page}.json`);

                    let items = [];
                    let cacheHit = false;
                    const CACHE_TTL_MS = 15 * 24 * 60 * 60 * 1000; // 15 days cache validity

                    if (fs.existsSync(cacheFile)) {
                        const mtime = fs.statSync(cacheFile).mtimeMs;
                        if (Date.now() - mtime < CACHE_TTL_MS) {
                            try {
                                const cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                                items = cachedData.items || [];
                                queryRawItems.push(...items);
                                cacheHit = true;
                                console.log(`   [${String(totalApiCalls).padStart(3)}] "${query}" p${page} → 💾 CACHED (${items.length} items)`);
                            } catch (e) {
                                // Bad json, will refetch
                            }
                        }
                    }

                    if (!cacheHit) {
                        process.stdout.write(`   [${String(totalApiCalls).padStart(3)}] "${query}" p${page} → `);
                        try {
                            const response = await fetch(url);
                            if (!response.ok) {
                                console.log(`❌ HTTP ${response.status}`);
                                continue;
                            }
                            const data = await response.json();
                            items = (data && data.items) ? data.items : [];
                            queryRawItems.push(...items);
                            console.log(`✅ ${items.length} items (Fetched & Cached)`);

                            // Save to cache
                            fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');

                            // Stop paginating if page returned < 10 items (end of results)
                            if (items.length < 10) break;

                        } catch (fetchErr) {
                            console.log(`⚠️  Fetch error: ${fetchErr.message}`);
                        }

                        // Polite delay to avoid rate limiting only when calling API
                        await new Promise(r => setTimeout(r, 300));
                    } else {
                        // Stop paginating if cached page has < 10 items
                        if (items.length < 10) break;
                    }
                }

                // Incremental process & save for this query
                if (queryRawItems.length > 0) {
                    const processed = processWalmartData(queryRawItems);
                    let newCountForQuery = 0;
                    const newProductsForQuery = [];

                    for (const product of processed) {
                        if (!knownIds.has(product.id)) {
                            knownIds.add(product.id);
                            newProductsForQuery.push(product);
                            newCountForQuery++;
                        }
                    }

                    if (newCountForQuery > 0) {
                        currentProducts.push(...newProductsForQuery);
                        totalNewCount += newCountForQuery;
                        console.log(`      ✨ Found ${newCountForQuery} new unique products. Saving increment...`);
                        
                        // Save DB and update HTML index after each query
                        saveDatabase(currentProducts);
                        updateHtmlFile(currentProducts);
                    }
                }
            }
            
            console.log(`\n📦 Total API requests made: ${totalApiCalls}`);
            console.log(`📊 Run Summary: Ingested & Saved ${totalNewCount} new products (Total database: ${currentProducts.length})`);
        }

        console.log('\n✨ Success! HTML + DB updated successfully.');
        console.log(`🚀 Ready to deploy to Cloudflare Pages!`);
        console.log('==================================================');

    } catch (error) {
        console.error('\n❌ Automation Failed!');
        console.error('Reason:', error.message);
        console.log('==================================================');
        process.exit(1);
    }
}

// Execute
main();
