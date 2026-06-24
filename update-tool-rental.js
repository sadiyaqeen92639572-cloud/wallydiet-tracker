/**
 * Tool Rental Prices Automation Script
 * File: update-tool-rental.js
 *
 * Scrapes Home Depot and Lowe's tool rental catalogs
 * Outputs: tool-rental.html + tool-rental-db.json
 *
 * MODES:
 *   node update-tool-rental.js          → Daily update (new equipment only)
 *   node update-tool-rental.js --full  → Full initial scrape
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CONFIGURATION & CREDENTIALS
// ==========================================
const SCRAPERAPI_KEY      = process.env.SCRAPER_API_KEY || 'YOUR_SCRAPERAPI_KEY';
const SCRAPERAPI_ENDPOINT = 'https://api.scraperapi.com/structured';

const OXY_USER = process.env.OXY_USER || null;
const OXY_PASS = process.env.OXY_PASS || null;
const OXY_ENDPOINT = 'https://realtime.oxylabs.io/v1/queries';

const USE_OXYLABS = !!(OXY_USER && OXY_PASS);
if (USE_OXYLABS) {
    console.log('🔵 Provider: Oxylabs');
} else {
    console.log('🟢 Provider: ScraperAPI');
}

const HTML_FILE = path.join(__dirname, 'tool-rental.html');
const DB_FILE = path.join(__dirname, 'tool-rental-db.json');
const CACHE_DIR = path.join(__dirname, 'tool-rental-cache');
const CACHE_TTL_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

const IS_FULL_SCRAPE = process.argv.includes('--full');
const MAX_PAGES = IS_FULL_SCRAPE ? 3 : 1;

// Equipment categories and search queries
const CATEGORIES = {
    'earthmoving': [
        'mini excavator rental',
        'skid steer rental',
        'backhoe rental',
        'bulldozer rental',
        'trencher rental'
    ],
    'power-tools': [
        'jackhammer rental',
        'rotary hammer rental',
        'power washer rental',
        'sander rental',
        'nail gun rental',
        'generator rental',
        'air compressor rental'
    ],
    'concrete': [
        'concrete mixer rental',
        'cement mixer rental',
        'concrete saw rental',
        'trowel rental',
        'concrete vibrator rental'
    ],
    'scaffolding': [
        'boom lift rental',
        'scissor lift rental',
        'scaffolding rental',
        'aerial lift rental',
        'cherry picker rental',
        'forklift rental'
    ]
};

// ==========================================
// 2. UNIFIED API FETCH (ScraperAPI / Oxylabs)
// ==========================================
async function fetchFromApi(source, query, page = 1) {
    if (USE_OXYLABS) {
        const credentials = Buffer.from(`${OXY_USER}:${OXY_PASS}`).toString('base64');
        const response = await fetch(OXY_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${credentials}`
            },
            body: JSON.stringify({
                source: source === 'homedepot' ? 'home_depot_search' : 'lowes_search',
                query: query,
                parse: true,
                start_page: page,
                pages: 1
            })
        });
        if (!response.ok) {
            throw new Error(`Oxylabs HTTP ${response.status}`);
        }
        const raw = await response.json();
        return { items: raw.results?.[0]?.content?.results?.organic || [] };
    } else {
        const endpoint = source === 'homedepot'
            ? `${SCRAPERAPI_ENDPOINT}/home_depot/search`
            : `${SCRAPERAPI_ENDPOINT}/lowes/search`;

        const url = `${endpoint}?api_key=${SCRAPERAPI_KEY}&query=${encodeURIComponent(query)}&page=${page}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`${source.toUpperCase()} HTTP ${response.status}`);
        }
        return await response.json();
    }
}

// ==========================================
// 3. CACHE RÉSEAU
// ==========================================
function getCacheFile(source, query, page) {
    const safeQuery = query.toLowerCase().replace(/[^a-z0-9]/gi, '_');
    return path.join(CACHE_DIR, `${source}_${safeQuery}_p${page}.json`);
}

async function fetchWithCache(source, query, page = 1) {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const cacheFile = getCacheFile(source, query, page);

    // Check cache
    if (fs.existsSync(cacheFile)) {
        const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
        if (age < CACHE_TTL_MS) {
            console.log(`   💾 CACHE HIT: ${source} "${query}" p${page}`);
            return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        }
    }

    // Fetch from API
    console.log(`   📡 API: ${source} "${query}" p${page}`);
    const data = await fetchFromApi(source, query, page);
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    return data;
}

// ==========================================
// 4. MOCK DATA (dév)
// ==========================================
const MOCK_RENTAL_DATA = [
    {
        id: 'hd-mini-excavator-1ton',
        equipment: 'Mini Excavator 1-Ton',
        category: 'earthmoving',
        homedepot_daily: 225,
        lowes_daily: 240,
        weekly_rate: 850,
        deposit: 500,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/mini-excavator'
    },
    {
        id: 'hd-skid-steer',
        equipment: 'Skid Steer Loader',
        category: 'earthmoving',
        homedepot_daily: 295,
        lowes_daily: 310,
        weekly_rate: 1100,
        deposit: 750,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/skid-steer'
    },
    {
        id: 'hd-jackhammer-90lb',
        equipment: 'Jackhammer 90lb Electric',
        category: 'power-tools',
        homedepot_daily: 85,
        lowes_daily: 79,
        weekly_rate: 320,
        deposit: 150,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/jackhammer'
    },
    {
        id: 'hd-boom-lift-40ft',
        equipment: 'Boom Lift 40ft Articulated',
        category: 'scaffolding',
        homedepot_daily: 310,
        lowes_daily: 330,
        weekly_rate: 1150,
        deposit: 1000,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/boom-lift'
    },
    {
        id: 'hd-concrete-mixer-9cf',
        equipment: 'Concrete Mixer 9 Cu. Ft.',
        category: 'concrete',
        homedepot_daily: 65,
        lowes_daily: 62,
        weekly_rate: 250,
        deposit: 100,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/concrete-mixer'
    },
    {
        id: 'hd-power-washer-4000psi',
        equipment: 'Pressure Washer 4000 PSI',
        category: 'power-tools',
        homedepot_daily: 75,
        lowes_daily: 72,
        weekly_rate: 290,
        deposit: 100,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/pressure-washer'
    },
    {
        id: 'hd-stump-grinder-13hp',
        equipment: 'Stump Grinder 13HP Gas',
        category: 'earthmoving',
        homedepot_daily: 110,
        lowes_daily: 105,
        weekly_rate: 410,
        deposit: 150,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/stump-grinder'
    },
    {
        id: 'hd-scissor-lift-19ft',
        equipment: 'Scissor Lift 19ft Electric',
        category: 'scaffolding',
        homedepot_daily: 145,
        lowes_daily: 155,
        weekly_rate: 520,
        deposit: 300,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/scissor-lift'
    },
    {
        id: 'hd-trencher-24inch',
        equipment: 'Trencher 24 inch Walk Behind',
        category: 'earthmoving',
        homedepot_daily: 165,
        lowes_daily: 175,
        weekly_rate: 620,
        deposit: 250,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/trencher'
    },
    {
        id: 'hd-generator-8000w',
        equipment: 'Portable Generator 8000W',
        category: 'power-tools',
        homedepot_daily: 95,
        lowes_daily: 89,
        weekly_rate: 360,
        deposit: 200,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/generator'
    },
    {
        id: 'hd-sander-floor',
        equipment: 'Floor Sander Drum',
        category: 'power-tools',
        homedepot_daily: 55,
        lowes_daily: 52,
        weekly_rate: 210,
        deposit: 80,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/floor-sander'
    },
    {
        id: 'hd-concrete-saw-14inch',
        equipment: 'Concrete Saw 14 inch Gas',
        category: 'concrete',
        homedepot_daily: 95,
        lowes_daily: 99,
        weekly_rate: 370,
        deposit: 150,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/concrete-saw'
    },
    {
        id: 'hd-air-compressor-200cfm',
        equipment: 'Air Compressor 200 CFM Diesel',
        category: 'power-tools',
        homedepot_daily: 185,
        lowes_daily: 195,
        weekly_rate: 700,
        deposit: 350,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/air-compressor'
    },
    {
        id: 'hd-backhoe-14ft',
        equipment: 'Backhoe 14ft Digging Depth',
        category: 'earthmoving',
        homedepot_daily: 385,
        lowes_daily: 395,
        weekly_rate: 1400,
        deposit: 1000,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/backhoe'
    },
    {
        id: 'hd-aerial-lift-60ft',
        equipment: 'Aerial Lift 60ft Boom',
        category: 'scaffolding',
        homedepot_daily: 395,
        lowes_daily: 420,
        weekly_rate: 1450,
        deposit: 1500,
        affiliate_url: 'https://www.homedepot.com/tool-truck/rental/aerial-lift'
    }
];

// ==========================================
// 5. DATA PROCESSING
// ==========================================
function processRentalData(rawItems, category) {
    const processed = [];

    for (const item of rawItems) {
        const id = item.id || `tr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const equipment = item.equipment || item.title || item.name || 'Unknown Equipment';

        // Parse prices (fallback to mock data structure)
        const homedepot_daily = parsePrice(item.homedepot_daily || item.price_homedepot || item.daily_rate || 0);
        const lowes_daily = parsePrice(item.lowes_daily || item.price_lowes || 0);
        const weekly_rate = parsePrice(item.weekly_rate || item.weekly || (Math.max(homedepot_daily, lowes_daily) * 3.5));
        const deposit = parsePrice(item.deposit || item.security_deposit || (weekly_rate * 0.2));

        // Skip if no pricing data
        if (homedepot_daily === 0 && lowes_daily === 0) {
            continue;
        }

        processed.push({
            id,
            equipment: equipment.charAt(0).toUpperCase() + equipment.slice(1),
            category,
            homedepot_daily: homedepot_daily || lowes_daily, // Fallback to Lowe's price
            lowes_daily: lowes_daily || homedepot_daily, // Fallback to Home Depot price
            weekly_rate,
            deposit,
            affiliate_url: item.affiliate_url || item.url || '#'
        });
    }

    return processed;
}

function parsePrice(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const match = value.match(/[\d,]+\.?\d*/);
        if (match) return parseFloat(match[0].replace(/,/g, ''));
    }
    return 0;
}

// ==========================================
// 6. HTML INJECTION
// ==========================================
function buildStaticRow(item) {
    const bestValue = item.lowes_daily < item.homedepot_daily ? 'best-value' : '';
    const storeClass = item.lowes_daily < item.homedepot_daily ? 'store-lowes' : 'store-homedepot';

    return `                    <tr data-category="${item.category}">
                        <td class="col-equipment">
                            <span class="equipment-name">${item.equipment}</span>
                            <span class="equipment-category">${item.category.replace('-', ' ')}</span>
                        </td>
                        <td class="col-price">$${item.homedepot_daily.toFixed(2)}</td>
                        <td class="col-price ${bestValue}">$${item.lowes_daily.toFixed(2)}</td>
                        <td class="col-price weekly">$${item.weekly_rate.toFixed(2)}</td>
                        <td class="col-deposit">$${item.deposit.toFixed(2)}</td>
                        <td class="col-link">
                            <a href="${item.affiliate_url}" target="_blank" rel="nofollow sponsored" class="rental-btn">
                                Check ↗
                            </a>
                        </td>
                    </tr>`;
}

function updateHtmlFile(products) {
    if (!fs.existsSync(HTML_FILE)) {
        throw new Error(`tool-rental.html not found at ${HTML_FILE}`);
    }

    let html = fs.readFileSync(HTML_FILE, 'utf8');

    // Inject JSON data
    const jsonStart = '/* START_JSON_DATA */';
    const jsonEnd = '/* END_JSON_DATA */';
    const jsonIndex = html.indexOf(jsonStart);
    const jsonEndIndex = html.indexOf(jsonEnd);

    if (jsonIndex === -1 || jsonEndIndex === -1) {
        throw new Error('JSON markers not found in tool-rental.html');
    }

    const formattedJson = JSON.stringify(products, null, 8);
    html = html.slice(0, jsonIndex) +
           `${jsonStart}\n        const EQUIPMENT_DATA = ${formattedJson.trim()};\n        ${jsonEnd}` +
           html.slice(jsonEndIndex + jsonEnd.length);

    // Inject table rows
    const rowsStart = '<!-- START_TABLE_ROWS -->';
    const rowsEnd = '<!-- END_TABLE_ROWS -->';
    const rowsIndex = html.indexOf(rowsStart);
    const rowsEndIndex = html.indexOf(rowsEnd);

    if (rowsIndex === -1 || rowsEndIndex === -1) {
        throw new Error('Table rows markers not found in tool-rental.html');
    }

    const staticRows = products.map(buildStaticRow).join('\n');
    html = html.slice(0, rowsIndex) +
           `${rowsStart}\n${staticRows}\n                    ${rowsEnd}` +
           html.slice(rowsEndIndex + rowsEnd.length);

    fs.writeFileSync(HTML_FILE, html);
    console.log(`✅ tool-rental.html updated (${products.length} equipment)`);
}

// ==========================================
// 7. DATABASE HELPERS
// ==========================================
function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        return { products: [], knownIds: new Set() };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        const products = Array.isArray(raw) ? raw : [];
        const knownIds = new Set(products.map(p => p.id));
        console.log(`📂 DB loaded: ${products.length} equipment`);
        return { products, knownIds };
    } catch (e) {
        console.error('⚠️  DB corrupted, starting fresh');
        return { products: [], knownIds: new Set() };
    }
}

function saveDatabase(products) {
    const tmpPath = DB_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(products, null, 2));
    fs.renameSync(tmpPath, DB_FILE);
    console.log(`💾 DB saved: ${products.length} equipment`);
}

// ==========================================
// 8. MAIN LOOP
// ==========================================
async function main() {
    console.log('==================================================');
    console.log(`🔧 Tool Rental Tracker — ${IS_FULL_SCRAPE ? '🚀 FULL' : '⚡ Daily'}`);
    console.log(`   Categories: ${Object.keys(CATEGORIES).length} | Pages: ${MAX_PAGES}`);
    console.log('==================================================');

    try {
        const { products: existingProducts, knownIds } = loadDatabase();
        let allProducts = [...existingProducts];

        if (SCRAPERAPI_KEY === 'YOUR_SCRAPERAPI_KEY' && !USE_OXYLABS) {
            console.log('⚠️  Mock mode — using MOCK_RENTAL_DATA');
            const processed = MOCK_RENTAL_DATA;
            let newCount = 0;
            for (const p of processed) {
                if (!knownIds.has(p.id)) {
                    knownIds.add(p.id);
                    allProducts.push(p);
                    newCount++;
                }
            }
            if (newCount > 0) {
                saveDatabase(allProducts);
                updateHtmlFile(allProducts);
                console.log(`✨ Added ${newCount} mock equipment`);
            }
        } else {
            console.log(`\n📡 Scraping Home Depot & Lowe's...\n`);

            for (const [category, queries] of Object.entries(CATEGORIES)) {
                console.log(`\n📁 Category: ${category}`);

                for (const query of queries) {
                    let totalNew = 0;

                    // Scrape both stores
                    for (const store of ['homedepot', 'lowes']) {
                        for (let page = 1; page <= MAX_PAGES; page++) {
                            try {
                                const data = await fetchWithCache(store, query, page);
                                const items = data.items || [];

                                if (items.length > 0) {
                                    const processed = processRentalData(items, category);

                                    for (const product of processed) {
                                        if (!knownIds.has(product.id)) {
                                            knownIds.add(product.id);
                                            allProducts.push(product);
                                            totalNew++;
                                        }
                                    }

                                    if (items.length < 10) break; // End of results
                                }

                                await new Promise(r => setTimeout(r, 300)); // Rate limit
                            } catch (e) {
                                console.error(`   ⚠️  ${store} "${query}" p${page}: ${e.message}`);
                            }
                        }
                    }

                    if (totalNew > 0) {
                        saveDatabase(allProducts);
                        updateHtmlFile(allProducts);
                        console.log(`   ✨ +${totalNew} new equipment`);
                    }
                }
            }
        }

        console.log(`\n🎉 Success! Total equipment: ${allProducts.length}`);
        console.log(`🚀 Ready to deploy tool-rental.html`);

    } catch (error) {
        console.error('\n❌ Failed:', error.message);
        process.exit(1);
    }
}

main();