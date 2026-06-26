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
    // Collagen
    'collagen peptides grass fed third party tested',
    'marine collagen powder hydrolyzed',
    'hydrolyzed collagen type I III best value',
    'collagen peptides NSF certified clean label',
    'collagen supplement price per gram',
    'collagen powder no fillers unflavored',
    // Ashwagandha
    'ashwagandha KSM-66 third party tested',
    'ashwagandha NSF certified withanolides',
    'ashwagandha root extract best value',
    'Sensoril ashwagandha stress anxiety sleep',
    'ashwagandha withanolides price comparison',
    'organic ashwagandha root powder no fillers',
    // Magnesium
    'magnesium glycinate sleep stress third party tested',
    'magnesium L-threonate brain cognitive',
    'best magnesium elemental absorption price comparison',
    'non-buffered magnesium bisglycinate pure',
    'magnesium citrate vs glycinate best value',
    'magnesium malate energy fibromyalgia',
    'magnesium complex multi-form supplement',
    // Turmeric / Curcumin
    'turmeric curcumin 95 curcuminoids third party tested',
    'best turmeric supplement bioperine absorption',
    'curcumin phytosome meriva bcm-95 bioavailable',
    'liposomal curcumin high absorption',
    'turmeric curcumin price per serving best value',
    'curcumin supplement no bioperine clean label',
    'theracurmin curcumin best bioavailability',
    // Zinc
    'zinc picolinate third party tested',
    'zinc bisglycinate chelated TRAACS gentle stomach',
    'best zinc supplement with copper ratio',
    'zinc lozenges cold immune support acetate',
    'zinc supplement no nausea sensitive stomach',
    'zinc picolinate 50mg best absorbed form',
    'zinc gluconate lozenges best value price',
    // Vitamin D
    'vitamin D3 K2 MK7 third party tested',
    'best vitamin D3 5000 IU price per serving',
    'lichen vegan vitamin D3 K2',
    'liquid vitamin D3 drops MCT oil',
    'vitamin D3 K2 USP verified',
    'vitamin D3 10000 IU best value',
    'vitamin D3 K2 MK7 200mcg third party tested',
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
    if (/multivitamin|multi[\s-]?vitamin/.test(t)) return 'Multivitamin';
    if (/fish oil|omega[\s-]?3|epa.*dha|dha.*epa|cod liver oil|krill oil|algae.*omega/.test(t)) return 'Fish Oil';
    if (/probiotic|acidophilus|lactobacillus|bifidobacterium|gut flora|digestive enzymes.*probiotic/i.test(t)) return 'Probiotics';
    if (/berberine/i.test(t)) return 'Berberine';
    if (/turmeric|curcumin|curcuma\s*longa/i.test(t)) return 'Turmeric';
    if (/ashwagandha|withania\s*somnifera|\bksm[\s-]?66\b|\bsensoril\b|\bshoden\b/i.test(t)) return 'Ashwagandha';
    if (/magnesium|mag.*glycinate|mag.*threonate|mag.*citrate|mag.*malate|\bmagnesium\s*(?:glycinate|bisglycinate|threonate|citrate|malate|taurate|oxide|chloride)\b/i.test(t)) return 'Magnesium';
    if (/vitamin[\s-]?d[23]?(?:\s|$|\b)|cholecalciferol|d3.*iu|\bvit\.?\s*d\b/i.test(t)) return 'Vitamin D';
    if (/\bzinc\b/i.test(t)) return 'Zinc';
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
    { regex: /stick[\s-]?pack|stickpack|individual\s*packet|single[\s-]?serve\s*packet/i, tag: 'Stick Pack' },
    { regex: /\bbulk\s*(?:tub|jug|bag|container|powder)\b|\btub\b|\bcanister\b/i, tag: 'Bulk Tub' },
    { regex: /effervescent|fizzing?\s*tablet|\bnuun\b/i, tag: 'Effervescent' },
    { regex: /berberine\s*hcl/i, tag: 'Berberine HCl' },
    { regex: /dihydroberberine|\bdhb\b/i, tag: 'Dihydroberberine' },
    { regex: /blood\s*sugar\s*support/i, tag: 'Blood Sugar Support' },
    { regex: /glp[\s-]?1/i, tag: 'GLP-1 Support' },
    { regex: /grass[\s-]?fed\s*collagen|collagen.*grass[\s-]?fed/i, tag: 'Grass-Fed Collagen' },
    { regex: /marine\s*collagen/i, tag: 'Marine Collagen' },
    { regex: /type\s*i\s*(?:and|&|\+)\s*(?:type\s*)?iii|type\s*1\s*(?:and|&|\+)\s*(?:type\s*)?3/i, tag: 'Type I+III' },
    { regex: /type\s*ii\b|type\s*2\s*collagen/i, tag: 'Type II' },
    { regex: /hydrolyzed\s*collagen|collagen\s*peptide/i, tag: 'Hydrolyzed' },
    { regex: /verisol/i, tag: 'Verisol' },
    { regex: /\bpeptan\b/i, tag: 'Peptan' },
    { regex: /fortigel/i, tag: 'Fortigel' },
    { regex: /fortibone/i, tag: 'Fortibone' },
    { regex: /tendofor/i, tag: 'Tendofor' },
    { regex: /wild[\s-]?caught/i, tag: 'Wild-Caught' },
    { regex: /\bhalal\b/i, tag: 'Halal' },
    { regex: /\bkosher\b/i, tag: 'Kosher' },
    { regex: /\bbisglycinate\b/i, tag: 'Bisglycinate' },
    { regex: /\bglycinate\b/i, tag: 'Glycinate' },
    { regex: /l[\s-]?threonate|\bthreonate\b/i, tag: 'L-Threonate' },
    { regex: /\bmalate\b/i, tag: 'Malate' },
    { regex: /\bcitrate\b/i, tag: 'Citrate' },
    { regex: /\btaurate\b/i, tag: 'Taurate' },
    { regex: /\boxide\b/i, tag: 'Oxide' },
    { regex: /non[\s-]?buffered|pure\s*(?:magnesium\s*)?bisglycinate|100%\s*(?:chelated|bisglycinate)/i, tag: 'Unbuffered' },
    { regex: /magnesium\s*(?:complex|blend|breakthrough)|multi[\s-]?magnesium|full[\s-]?spectrum\s*magnesium/i, tag: 'Multi-Form' },
    { regex: /\bksm[\s-]?66\b/i, tag: 'KSM-66' },
    { regex: /\bsensoril\b/i, tag: 'Sensoril' },
    { regex: /\bshoden\b/i, tag: 'Shoden' },
    { regex: /ashwagandha\s*root|root\s*(?:extract|powder|only)/i, tag: 'Root Extract' },
    { regex: /\bmk[\s-]?7\b|menaquinone[\s-]?7/i, tag: 'MK-7' },
    { regex: /\bmk[\s-]?4\b|menaquinone[\s-]?4|menatetrenone/i, tag: 'MK-4' },
    { regex: /\blichen\b|plant[\s-]?based\s*d3|vegan\s*d3/i, tag: 'Lichen D3' },
    { regex: /liquid\s*drops?|(?:d3|vitamin\s*d).*drops?|drops?.*(?:d3|vitamin\s*d)/i, tag: 'Liquid Drops' },
    { regex: /bioperine|\bpiperine\b|\bblack\s*pepper\b/i, tag: 'BioPerine' },
    { regex: /\btheracurmin\b/i, tag: 'Theracurmin' },
    { regex: /\bbcm[\s-]?95\b|bio[\s-]?curcumax/i, tag: 'BCM-95' },
    { regex: /95%?\s*curcuminoids?|curcuminoids?\s*95%?/i, tag: '95% Curcuminoids' },
    { regex: /\bliposomal\b.*(?:curcumin|turmeric)|(?:curcumin|turmeric).*\bliposomal\b/i, tag: 'Liposomal Curcumin' },
    { regex: /\bnovasol\b|micellar\s*curcumin/i, tag: 'NovaSOL' },
    { regex: /\btraacs\b/i, tag: 'TRAACS' },
    { regex: /\boptizinc\b/i, tag: 'OptiZinc' },
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

function parseCollagenGrams(text) {
    const t = (text || '');
    // Pattern 1: "Xg of collagen" — explicit forward, word boundary on g to avoid "Grass"
    const fwd = t.match(/(\d+(?:\.\d+)?)\s*g(?:rams?)?\b\s*(?:of\s*)?(?:per\s*serving\s*)?(?:hydrolyzed\s*)?collagen/i);
    if (fwd) { const v = parseFloat(fwd[1]); if (v >= 1 && v < 50) return v; }
    // Pattern 2: "XG Collagen" — number+G immediately before "Collagen" (with word boundary)
    const direct = t.match(/(\d+(?:\.\d+)?)\s*G\b\s+(?:of\s+)?(?:hydrolyzed\s*)?Collagen/);
    if (direct) { const v = parseFloat(direct[1]); if (v >= 1 && v < 50) return v; }
    // Pattern 3: "collagen...Xg" — short-range, requires word boundary after g to prevent "Grass"
    const rev = t.match(/\bcollagen\b[^0-9]{1,25}(\d+(?:\.\d+)?)\s*g(?:rams?)?\b(?!\s*(?:protein|fat|carb|fiber|sugar|sodium|calories|cal\b|glyc|lyc|lute|lucose))/i);
    if (rev) { const v = parseFloat(rev[1]); if (v >= 1 && v < 50) return v; }
    // Pattern 4: mg collagen
    const mgMatch = t.match(/(\d+)\s*mg\s*(?:of\s*)?collagen/i);
    if (mgMatch) return Math.round(parseInt(mgMatch[1]) / 1000 * 100) / 100;
    return 0;
}

function parseCollagenType(text) {
    const t = (text || '');
    if (/type\s*ii\b|type\s*2\s*collagen/i.test(t)) return 'Type II';
    if (/type\s*i\s*(?:and|&|\+)\s*(?:type\s*)?iii|type\s*1\s*(?:and|&|\+)\s*(?:type\s*)?3/i.test(t)) return 'Type I+III';
    if (/type\s*i\b|type\s*1\b/i.test(t)) return 'Type I';
    return null;
}

function parseCollagenSource(text) {
    const t = (text || '');
    if (/marine|fish\s*collagen/i.test(t)) return 'Marine';
    if (/bovine|beef\s*collagen|cow/i.test(t)) return 'Bovine';
    if (/chicken\s*collagen/i.test(t)) return 'Chicken';
    if (/vegan\s*collagen/i.test(t)) return 'Vegan';
    return null;
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

function parseCurcuminoids(text) {
    const t = (text || '');
    const num = s => parseInt((s || '').replace(/,/g, ''));

    // Explicit: "500mg curcuminoids" or "curcuminoids 500mg"
    const explicit = t.match(/(\d[\d,]*)\s*mg\s*(?:of\s*)?(?:standardized\s*)?curcuminoids?/i) ||
                     t.match(/curcuminoids?[:\s]+(\d[\d,]*)\s*mg/i);
    if (explicit) { const v = num(explicit[1]); if (v > 0 && v <= 5000) return v; }

    // "Xmg Turmeric/Curcumin Extract Y% Curcuminoids" (gap up to 60 chars)
    const extract = t.match(/(\d[\d,]*)\s*mg\s*(?:turmeric\s*)?(?:root\s*)?extract[^%]{0,60}(\d+(?:\.\d+)?)\s*%\s*(?:pure\s*|standardized\s*)?curcuminoids?/i);
    if (extract) {
        const dose = num(extract[1]); const pct = parseFloat(extract[2]);
        if (dose > 0 && pct >= 80 && pct <= 100) return Math.round(dose * pct / 100);
    }

    // General: title contains "Y% curcuminoids" (any %) — find the most plausible dose mg
    const pctMatch = t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:pure\s*|standardized\s*)?curcuminoids?/i);
    if (pctMatch) {
        const pct = parseFloat(pctMatch[1]);
        if (pct >= 80 && pct <= 100) {
            // Collect all mg values from title, filter to plausible serving range
            const mgAll = [...t.matchAll(/(\d[\d,]*)\s*mg/gi)]
                .map(m => num(m[1]))
                .filter(n => n >= 100 && n <= 5000);
            if (mgAll.length > 0) {
                // Pick smallest plausible: per-serving dose < total complex weight
                return Math.round(Math.min(...mgAll) * pct / 100);
            }
        }
    }

    // "Xmg Curcumin" (standalone = already standardized) — exclude phytosome only
    const curcumin = t.match(/(\d[\d,]*)\s*mg\s*curcumin(?!\s*phytosome)/i);
    if (curcumin) { const v = num(curcumin[1]); if (v > 0 && v <= 2000) return v; }

    // "Xmg Turmeric Y%" (gap up to 60 chars)
    const turmericPct = t.match(/(\d[\d,]*)\s*mg\s*(?:turmeric|curcuma)[^%]{0,60}(\d+(?:\.\d+)?)\s*%/i);
    if (turmericPct) {
        const dose = num(turmericPct[1]); const pct = parseFloat(turmericPct[2]);
        if (dose > 0 && pct >= 80 && pct <= 100) return Math.round(dose * pct / 100);
    }

    // Raw turmeric without % → skip (3-5% natural curcuminoids, too noisy)
    return 0;
}

function parseZincMg(text) {
    const t = (text || '');
    const num = s => parseInt((s || '').replace(/,/g, ''));

    // "Zinc 50mg" or "Zinc Picolinate 50mg" (form between zinc and mg)
    const fwd = t.match(/\bzinc(?:\s+(?:picolinate|gluconate|bisglycinate|citrate|oxide|sulfate|acetate|monomethionine|methionine|carnosine|chelate|chelated|glycinate|lozenges?))?\s+(\d+(?:\.\d+)?)\s*mg\b/i);
    if (fwd) { const v = num(fwd[1]); if (v > 0 && v <= 100) return v; }

    // "50mg Zinc" (standalone elemental, not part of larger compound list)
    const rev = t.match(/(\d+(?:\.\d+)?)\s*mg\s+zinc\b/i);
    if (rev) { const v = num(rev[1]); if (v > 0 && v <= 100) return v; }

    // TRAACS / OptiZinc branded: "TRAACS 25mg" or "OptiZinc 30mg"
    const branded = t.match(/(?:traacs|optizinc)(?:\s+zinc)?\s+(\d+(?:\.\d+)?)\s*mg\b/i);
    if (branded) { const v = num(branded[1]); if (v > 0 && v <= 100) return v; }

    // General gap: "Zinc [anything up to 50 chars] Xmg" — last resort
    const gap = t.match(/\bzinc\b.{0,50}?(\d+(?:\.\d+)?)\s*mg\b/i);
    if (gap) { const v = num(gap[1]); if (v >= 5 && v <= 100) return v; }

    return 0;
}

function parseZincForm(text) {
    const t = (text || '');
    if (/\btraacs\b/i.test(t)) return 'TRAACS';
    if (/\boptizinc\b/i.test(t) || /zinc\s+monomethionine/i.test(t)) return 'OptiZinc';
    if (/zinc\s+bisglycinate\b/i.test(t)) return 'Bisglycinate';
    if (/zinc\s+picolinate\b/i.test(t)) return 'Picolinate';
    if (/zinc\s+(?:lozenges?|acetate)\b/i.test(t) || /zinc\s+acetate/i.test(t)) return 'Lozenge/Acetate';
    if (/zinc\s+gluconate\b/i.test(t)) return 'Gluconate';
    if (/zinc\s+citrate\b/i.test(t)) return 'Citrate';
    if (/zinc\s+(?:amino\s*)?chelate\b|chelated\s*zinc/i.test(t)) return 'Chelate';
    if (/zinc\s+oxide\b/i.test(t)) return 'Oxide';
    if (/zinc\s+sulfate\b/i.test(t)) return 'Sulfate';
    return null;
}

function parseSodiumMg(text) {
    const t = (text || '');
    // "800mg Sodium" / "800 mg sodium" / "1,000mg Sodium"
    const fwd = t.match(/(\d[\d,]*)\s*mg\s*(?:of\s*)?sodium/i);
    if (fwd) return parseInt(fwd[1].replace(/,/g, ''));
    // "Sodium 800mg" / "Sodium: 1000mg"
    const rev = t.match(/\bsodium[:\s]+(\d[\d,]*)\s*mg/i);
    if (rev) return parseInt(rev[1].replace(/,/g, ''));
    // "800mg Na" (shorthand)
    const na = t.match(/(\d[\d,]*)\s*mg\s*Na\b/i);
    if (na) return parseInt(na[1].replace(/,/g, ''));
    return 0;
}

function parseMagnesiumMg(text) {
    const t = (text || '');
    // Explicit elemental: "200mg elemental magnesium" or "elemental magnesium 200mg"
    const explicit = t.match(/(\d+)\s*mg\s*(?:of\s*)?elemental\s*magnesium/i) ||
                     t.match(/elemental\s*magnesium[:\s]+(\d+)\s*mg/i);
    if (explicit) return parseInt(explicit[1]);

    const FORM_RE = '(bisglycinate|glycinate|l[\\s\\-]?threonate|threonate|malate|citrate|taurate|oxide)';
    function inferElemental(dose, formStr) {
        const f = (formStr || '').toLowerCase().replace(/[\s-]/g, '');
        if (dose <= 0 || dose > 2000) return 0;
        if (f === 'bisglycinate' || f === 'glycinate') return Math.round(dose * 0.14);
        if (f === 'lthreonate' || f === 'threonate') return Math.round(dose * 0.075);
        if (f === 'malate') return Math.round(dose * 0.15);
        if (f === 'citrate') return Math.round(dose * 0.16);
        if (f === 'taurate') return Math.round(dose * 0.088);
        if (f === 'oxide') return Math.round(dose * 0.60);
        return 0;
    }

    // Forward: "400mg Glycinate" or "400mg Magnesium Glycinate"
    const fwd = t.match(new RegExp('(\\d+)\\s*mg\\s*(?:magnesium\\s*)?' + FORM_RE, 'i'));
    if (fwd) return inferElemental(parseInt(fwd[1]), fwd[2]);

    // Reverse: "Glycinate 400mg" or "Magnesium Glycinate 400mg"
    const rev = t.match(new RegExp('(?:magnesium\\s*)?' + FORM_RE + '\\s+(\\d+)\\s*mg', 'i'));
    if (rev) return inferElemental(parseInt(rev[2]), rev[1]);

    return 0;
}

function parseMagnesiumForm(text) {
    const t = (text || '');
    if (/l[\s-]?threonate|\bthreonate\b/i.test(t)) return 'L-Threonate';
    if (/bisglycinate/i.test(t)) return 'Bisglycinate';
    if (/\bglycinate\b/i.test(t)) return 'Glycinate';
    if (/\bmalate\b/i.test(t)) return 'Malate';
    if (/\bcitrate\b/i.test(t)) return 'Citrate';
    if (/\btaurate\b/i.test(t)) return 'Taurate';
    if (/\boxide\b/i.test(t)) return 'Oxide';
    if (/complex|blend|breakthrough|multi[\s-]?magnesium/i.test(t)) return 'Multi-Form';
    return null;
}

function parseIU(text) {
    const t = (text || '');
    // "5000 IU", "5,000 IU", "10000IU"
    const m = t.match(/(\d[\d,]*)\s*IU/i);
    if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v >= 100 && v <= 100000) return v;
    }
    return 0;
}

function parseK2mcg(text) {
    const t = (text || '');
    // "100mcg K2", "200 mcg MK-7", "K2 200mcg"
    const fwd = t.match(/(\d+)\s*mcg\s*(?:of\s*)?(?:vitamin\s*)?k2|(\d+)\s*mcg\s*mk[\s-]?7/i);
    if (fwd) return parseInt(fwd[1] || fwd[2]);
    const rev = t.match(/(?:vitamin\s*)?k2.*?(\d+)\s*mcg|mk[\s-]?7.*?(\d+)\s*mcg/i);
    if (rev) return parseInt(rev[1] || rev[2]);
    return 0;
}

function parseWithanolidesMg(text) {
    const t = (text || '');
    // Explicit withanolide mg: "10mg withanolides"
    const explicit = t.match(/(\d+(?:\.\d+)?)\s*mg\s*(?:of\s*)?withanolides?/i) ||
                     t.match(/withanolides?\s*(\d+(?:\.\d+)?)\s*mg/i);
    if (explicit) return parseFloat(explicit[1]);
    // Withanolide % × dose mg: "500mg 5% withanolides" → 25mg
    const pct = t.match(/(\d+)\s*mg[^,]{0,30}?(\d+(?:\.\d+)?)\s*%\s*withanolides?/i) ||
                t.match(/(\d+(?:\.\d+)?)\s*%\s*withanolides?[^,]{0,30}?(\d+)\s*mg/i);
    if (pct) {
        const mg = parseFloat(pct[1]);
        const pctVal = parseFloat(pct[2]);
        if (mg > 0 && pctVal > 0 && pctVal <= 100) return Math.round(mg * pctVal / 100 * 10) / 10;
    }
    // Known extract defaults: KSM-66=5%, Sensoril=10%, Shoden=35%
    const doseMatch = t.match(/(\d+)\s*mg\s*(?:ashwagandha|withania)/i) ||
                      t.match(/ashwagandha[^,]{0,20}?(\d+)\s*mg/i);
    const dose = doseMatch ? parseInt(doseMatch[1]) : 0;
    if (dose > 0) {
        if (/\bshoden\b/i.test(t)) return Math.round(dose * 0.35 * 10) / 10;
        if (/\bsensoril\b/i.test(t)) return Math.round(dose * 0.10 * 10) / 10;
        if (/\bksm[\s-]?66\b/i.test(t)) return Math.round(dose * 0.05 * 10) / 10;
    }
    return 0;
}

function parseAshwagandhaExtract(text) {
    const t = (text || '');
    if (/\bshoden\b/i.test(t)) return 'Shoden';
    if (/\bksm[\s-]?66\b/i.test(t)) return 'KSM-66';
    if (/\bsensoril\b/i.test(t)) return 'Sensoril';
    if (/\bwithania\s*somnifera\b/i.test(t)) return 'Standardized';
    return 'Generic';
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
    // 1. Explicit "X servings" — guard n>1 to avoid "1 Serving Per Day" dosage instruction
    const m = title.match(/(\d+)\s*serv/i);
    if (m && parseInt(m[1]) > 1) return parseInt(m[1]);
    // 2. "N Count" / "N-ct" / "N Cts" — check BEFORE unit patterns to avoid "1 Softgel per Serving" confusion
    //    BulkSupplements "90 Count (Pack of 1)" was returning 1 instead of 90
    const countMatch = title.match(/(\d+)[-\s](?:counts?|cts?)\b/i);
    if (countMatch && parseInt(countMatch[1]) > 1) return parseInt(countMatch[1]);
    // 3. Unit-based formats — use matchAll to find ALL matches and pick largest valid n
    //    Guards: n<=1 = serving instruction ("1 Capsule Daily"), n<=3 with omega/vitamin prefix
    const altRe = /(\d+)\s*(?:stickpack|stick\s*pack|packet|pouch|sachet|stick|(?:veggie\s*|vegetarian\s*|veg\s*|vegan\s*|delayed[\s-]?release\s*|enteric[\s-]?coated\s*|mini\s*)?capsule|(?:veggie\s*|veg\s*|vegan\s*)?cap|tablet|softgel|soft\s*gel|gummie|gummy|chew|lozenge|piece|pop|dose)s?\b/gi;
    const altMatches = [...title.matchAll(altRe)];
    if (altMatches.length > 0) {
        const candidates = altMatches
            .map(m => ({ n: parseInt(m[1]), idx: m.index, raw: m[0] }))
            .filter(({ n, idx, raw }) => {
                if (n <= 1) return false; // serving instruction ("1 Capsule Daily")
                if (n <= 3) {
                    const pre = title.substring(Math.max(0, idx - 15), idx);
                    if (/omega[\s-]?\d*\s*$/i.test(pre) || /vitamin\s+[a-z\d]+\s*$/i.test(pre)) return false;
                }
                return true;
            });
        if (candidates.length > 0) return Math.max(...candidates.map(c => c.n));
    }
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

    // Collagen — grams per serving, price per gram, type, source
    const collagenGrams = category === 'Collagen' ? parseCollagenGrams(fullText) : 0;
    const pricePerGramCollagen = (collagenGrams > 0 && servings && price)
        ? Math.round((price / (collagenGrams * servings)) * 100) / 100
        : null;
    const collagenType = category === 'Collagen' ? parseCollagenType(fullText) : null;
    const collagenSource = category === 'Collagen' ? parseCollagenSource(fullText) : null;

    // Berberine mg — price per 500mg dose + form + complex ingredients
    const berberineMg = category === 'Berberine' ? parseBerberineMg(fullText) : 0;
    const pricePer500mg = (berberineMg > 0 && servings && price)
        ? Math.round((price / (berberineMg * servings / 500)) * 100) / 100
        : null;
    const berberineForm = category === 'Berberine' ? parseBerberineForm(fullText) : null;
    const complexIngredients = category === 'Berberine'
        ? BERBERINE_COMPLEX_PATTERNS.filter(p => p.regex.test(fullText)).map(p => p.tag)
        : [];

    // Electrolytes — sodium mg, price per 1000mg sodium
    const sodiumMg = category === 'Electrolytes' ? parseSodiumMg(fullText) : 0;
    const pricePer1gSodium = (sodiumMg > 0 && servings && price)
        ? Math.round((price / (sodiumMg * servings / 1000)) * 100) / 100
        : null;

    // Magnesium — elemental mg, form, price per 100mg elemental
    const magnesiumMg = category === 'Magnesium' ? parseMagnesiumMg(fullText) : 0;
    const magnesiumForm = category === 'Magnesium' ? parseMagnesiumForm(fullText) : null;
    const pricePer100mgMg = (magnesiumMg > 0 && servings && price)
        ? Math.round((price / (magnesiumMg * servings / 100)) * 100) / 100 : null;

    // Vitamin D — IU dose, K2 mcg, price per 1000 IU
    const vitaminDIU = category === 'Vitamin D' ? parseIU(fullText) : 0;
    const k2mcg = category === 'Vitamin D' ? parseK2mcg(fullText) : 0;
    const pricePer1000IU = (vitaminDIU > 0 && servings && price)
        ? Math.round((price / (vitaminDIU * servings / 1000)) * 100) / 100 : null;

    // Turmeric — curcuminoids mg, price per 100mg curcuminoids
    const turmericCurcuminoids = category === 'Turmeric' ? parseCurcuminoids(fullText) : 0;
    const pricePer100mgCurcuminoids = (turmericCurcuminoids > 0 && servings && price)
        ? Math.round((price / (turmericCurcuminoids * servings / 100)) * 100) / 100 : null;

    // Zinc — elemental mg, form, price per 10mg zinc
    const zincMg = category === 'Zinc' ? parseZincMg(fullText) : 0;
    const zincForm = category === 'Zinc' ? parseZincForm(fullText) : null;
    const pricePer10mgZinc = (zincMg > 0 && servings && price)
        ? Math.round((price / (zincMg * servings / 10)) * 100) / 100 : null;

    // Ashwagandha — withanolides mg, price per mg withanolides, extract type
    const withanolidesMg = category === 'Ashwagandha' ? parseWithanolidesMg(fullText) : 0;
    const pricePerMgWithanolides = (withanolidesMg > 0 && servings && price)
        ? Math.round((price / (withanolidesMg * servings)) * 1000) / 1000
        : null;
    const ashwagandhaExtract = category === 'Ashwagandha' ? parseAshwagandhaExtract(fullText) : null;

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
        collagenGrams: collagenGrams,
        pricePerGramCollagen: pricePerGramCollagen,
        collagenType: collagenType,
        collagenSource: collagenSource,
        berberineMg: berberineMg,
        pricePer500mg: pricePer500mg,
        berberineForm: berberineForm,
        complexIngredients: complexIngredients,
        sodiumMg: sodiumMg,
        pricePer1gSodium: pricePer1gSodium,
        magnesiumMg: magnesiumMg,
        magnesiumForm: magnesiumForm,
        pricePer100mgMg: pricePer100mgMg,
        vitaminDIU: vitaminDIU,
        k2mcg: k2mcg,
        pricePer1000IU: pricePer1000IU,
        turmericCurcuminoids: turmericCurcuminoids,
        pricePer100mgCurcuminoids: pricePer100mgCurcuminoids,
        zincMg: zincMg,
        zincForm: zincForm,
        pricePer10mgZinc: pricePer10mgZinc,
        withanolidesMg: withanolidesMg,
        pricePerMgWithanolides: pricePerMgWithanolides,
        ashwagandhaExtract: ashwagandhaExtract,
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
    const collagenBadge = (item.collagenGrams > 0)
        ? `<span class="badge badge-cert">${item.collagenGrams}g Collagen</span>${item.pricePerGramCollagen ? '<span class="badge badge-free">$' + item.pricePerGramCollagen.toFixed(2) + '/g</span>' : ''}${item.collagenType ? '<span class="badge badge-claim">' + item.collagenType + '</span>' : ''}${item.collagenSource ? '<span class="badge badge-none">' + item.collagenSource + '</span>' : ''}`
        : '';
    const formColors = { 'Phytosome': 'badge-cert', 'Dihydroberberine': 'badge-claim', 'HCl': 'badge-none', 'Complex': 'badge-warn' };
    const berberineBadge = (item.berberineMg > 0)
        ? `<span class="badge badge-cert">${item.berberineMg}mg Berberine</span>${item.pricePer500mg ? '<span class="badge badge-free">$' + item.pricePer500mg.toFixed(2) + '/500mg</span>' : ''}${item.berberineForm ? '<span class="badge ' + (formColors[item.berberineForm] || 'badge-none') + '">' + item.berberineForm + '</span>' : ''}${(item.complexIngredients || []).map(c => '<span class="badge badge-warn">' + c + '</span>').join('')}`
        : '';
    const mgFormColors = { 'Bisglycinate': 'badge-cert', 'Glycinate': 'badge-cert', 'L-Threonate': 'badge-claim', 'Malate': 'badge-claim', 'Citrate': 'badge-free', 'Taurate': 'badge-free', 'Oxide': 'badge-warn', 'Multi-Form': 'badge-none' };
    const magnesiumBadge = (item.magnesiumMg > 0)
        ? `<span class="badge badge-cert">${item.magnesiumMg}mg Mg</span>${item.pricePer100mgMg ? '<span class="badge badge-free">$' + item.pricePer100mgMg.toFixed(2) + '/100mg</span>' : ''}${item.magnesiumForm ? '<span class="badge ' + (mgFormColors[item.magnesiumForm] || 'badge-none') + '">' + item.magnesiumForm + '</span>' : ''}`
        : (item.magnesiumForm ? `<span class="badge ${mgFormColors[item.magnesiumForm] || 'badge-none'}">${item.magnesiumForm}</span>` : '');
    const vitaminDBadge = (item.vitaminDIU > 0)
        ? `<span class="badge badge-cert">${item.vitaminDIU.toLocaleString()} IU</span>${item.k2mcg > 0 ? '<span class="badge badge-claim">K2 ' + item.k2mcg + 'mcg</span>' : ''}${item.pricePer1000IU ? '<span class="badge badge-free">$' + item.pricePer1000IU.toFixed(2) + '/1000 IU</span>' : ''}`
        : '';
    const sodiumBadge = (item.sodiumMg > 0)
        ? `<span class="badge badge-cert">${item.sodiumMg}mg Na</span>${item.pricePer1gSodium ? '<span class="badge badge-free">$' + item.pricePer1gSodium.toFixed(2) + '/g Na</span>' : ''}`
        : '';
    const extractColors = { 'KSM-66': 'badge-cert', 'Sensoril': 'badge-claim', 'Shoden': 'badge-cert', 'Standardized': 'badge-none', 'Generic': 'badge-none' };
    const ashwagandhaB = (item.withanolidesMg > 0)
        ? `<span class="badge badge-cert">${item.withanolidesMg}mg withanolides</span>${item.pricePerMgWithanolides ? '<span class="badge badge-free">$' + item.pricePerMgWithanolides.toFixed(3) + '/mg</span>' : ''}${item.ashwagandhaExtract ? '<span class="badge ' + (extractColors[item.ashwagandhaExtract] || 'badge-none') + '">' + item.ashwagandhaExtract + '</span>' : ''}`
        : (item.ashwagandhaExtract && item.ashwagandhaExtract !== 'Generic'
            ? `<span class="badge ${extractColors[item.ashwagandhaExtract] || 'badge-none'}">${item.ashwagandhaExtract}</span>`
            : '');

    const turmericBadge = (item.turmericCurcuminoids > 0)
        ? `<span class="badge badge-cert">${item.turmericCurcuminoids}mg Curcuminoids</span>${item.pricePer100mgCurcuminoids ? '<span class="badge badge-free">$' + item.pricePer100mgCurcuminoids.toFixed(2) + '/100mg</span>' : ''}`
        : '';

    const zincFormColors = { 'TRAACS': 'badge-cert', 'OptiZinc': 'badge-cert', 'Bisglycinate': 'badge-cert', 'Chelate': 'badge-cert', 'Picolinate': 'badge-claim', 'Gluconate': 'badge-none', 'Citrate': 'badge-none', 'Lozenge/Acetate': 'badge-none', 'Oxide': 'badge-warn', 'Sulfate': 'badge-warn' };
    const zincBadge = (item.zincMg > 0)
        ? `<span class="badge badge-cert">${item.zincMg}mg Zinc</span>${item.pricePer10mgZinc ? '<span class="badge badge-free">$' + item.pricePer10mgZinc.toFixed(2) + '/10mg</span>' : ''}${item.zincForm ? '<span class="badge ' + (zincFormColors[item.zincForm] || 'badge-none') + '">' + item.zincForm + '</span>' : ''}`
        : (item.zincForm ? `<span class="badge ${zincFormColors[item.zincForm] || 'badge-none'}">${item.zincForm}</span>` : '');

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
                        <td class="col-ingredients">${claimBadges}${omegaBadge || ''}${cfuBadge || ''}${collagenBadge || ''}${berberineBadge || ''}${ashwagandhaB || ''}${sodiumBadge || ''}${vitaminDBadge || ''}${magnesiumBadge || ''}${turmericBadge || ''}${zincBadge || ''}</td>
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

    // Re-enrich Collagen — always re-parse grams to pick up regex improvements
    let collagenEnriched = 0;
    for (const p of db) {
        if (p.category !== 'Collagen') continue;
        const freshGrams = parseCollagenGrams(p.title);
        if (freshGrams !== p.collagenGrams) {
            p.collagenGrams = freshGrams;
            p.pricePerGramCollagen = null; // force recalc below
        }
        if (p.collagenGrams > 0) {
            collagenEnriched++;
            if (!p.pricePerGramCollagen && p.servingsDeclared && p.priceListed) {
                p.pricePerGramCollagen = Math.round((p.priceListed / (p.collagenGrams * p.servingsDeclared)) * 100) / 100;
            }
        } else {
            p.pricePerGramCollagen = null;
        }
        p.collagenType = parseCollagenType(p.title);
        p.collagenSource = parseCollagenSource(p.title);
    }
    if (collagenEnriched > 0) console.log(`🫘 Enriched Collagen grams for ${collagenEnriched} products`);

    // Re-apply CLAIM_PATTERNS to all products (picks up newly added tags on existing products)
    let claimsUpdated = 0;
    for (const p of db) {
        const t = (p.title || '') + ' ' + (p.brand || '');
        const freshClaims = CLAIM_PATTERNS.filter(pt => pt.regex.test(t)).map(pt => pt.tag);
        const prev = JSON.stringify((p.claims || []).sort());
        const next = JSON.stringify(freshClaims.sort());
        if (prev !== next) { p.claims = freshClaims; claimsUpdated++; }
    }
    if (claimsUpdated > 0) console.log(`🏷️ Re-applied claims for ${claimsUpdated} products`);

    // Re-enrich Ashwagandha — always re-parse withanolides + extract type
    let ashEnriched = 0;
    for (const p of db) {
        if (p.category !== 'Ashwagandha') continue;
        const freshWitha = parseWithanolidesMg(p.title);
        if (freshWitha !== p.withanolidesMg) {
            p.withanolidesMg = freshWitha;
            p.pricePerMgWithanolides = null;
        }
        if (p.withanolidesMg > 0) {
            ashEnriched++;
            if (!p.pricePerMgWithanolides && p.servingsDeclared && p.priceListed) {
                p.pricePerMgWithanolides = Math.round((p.priceListed / (p.withanolidesMg * p.servingsDeclared)) * 1000) / 1000;
            }
        } else {
            p.pricePerMgWithanolides = null;
        }
        p.ashwagandhaExtract = parseAshwagandhaExtract(p.title);
    }
    if (ashEnriched > 0) console.log(`🌿 Enriched withanolides for ${ashEnriched} ashwagandha products`);

    // Re-enrich Electrolytes — sodium mg + price per 1g sodium
    let naEnriched = 0;
    for (const p of db) {
        if (p.category !== 'Electrolytes') continue;
        const freshNa = parseSodiumMg(p.title);
        if (freshNa !== p.sodiumMg) {
            p.sodiumMg = freshNa;
            p.pricePer1gSodium = null;
        }
        if (p.sodiumMg > 0) {
            naEnriched++;
            if (!p.pricePer1gSodium && p.servingsDeclared && p.priceListed) {
                p.pricePer1gSodium = Math.round((p.priceListed / (p.sodiumMg * p.servingsDeclared / 1000)) * 100) / 100;
            }
        } else {
            p.pricePer1gSodium = null;
        }
    }
    if (naEnriched > 0) console.log(`🧂 Enriched sodium for ${naEnriched} electrolyte products`);

    // Re-enrich Vitamin D — always re-parse IU + K2 mcg
    let vitDEnriched = 0;
    for (const p of db) {
        if (p.category !== 'Vitamin D') continue;
        const freshIU = parseIU(p.title);
        const freshK2 = parseK2mcg(p.title);
        if (freshIU !== p.vitaminDIU || freshK2 !== p.k2mcg) {
            p.vitaminDIU = freshIU;
            p.k2mcg = freshK2;
            p.pricePer1000IU = null;
        }
        if (p.vitaminDIU > 0) {
            vitDEnriched++;
            if (!p.pricePer1000IU && p.servingsDeclared && p.priceListed) {
                p.pricePer1000IU = Math.round((p.priceListed / (p.vitaminDIU * p.servingsDeclared / 1000)) * 100) / 100;
            }
        } else {
            p.pricePer1000IU = null;
        }
    }
    if (vitDEnriched > 0) console.log(`☀️ Enriched IU for ${vitDEnriched} Vitamin D products`);

    // Re-enrich Magnesium — always re-parse elemental mg + form
    let mgEnriched = 0;
    for (const p of db) {
        if (p.category !== 'Magnesium') continue;
        const freshMg = parseMagnesiumMg(p.title);
        const freshForm = parseMagnesiumForm(p.title);
        if (freshMg !== p.magnesiumMg || freshForm !== p.magnesiumForm) {
            p.magnesiumMg = freshMg;
            p.magnesiumForm = freshForm;
            p.pricePer100mgMg = null;
        }
        if (p.magnesiumMg > 0) {
            mgEnriched++;
            if (!p.pricePer100mgMg && p.servingsDeclared && p.priceListed) {
                p.pricePer100mgMg = Math.round((p.priceListed / (p.magnesiumMg * p.servingsDeclared / 100)) * 100) / 100;
            }
        } else {
            p.pricePer100mgMg = null;
        }
        if (!p.magnesiumForm) p.magnesiumForm = freshForm;
    }
    if (mgEnriched > 0) console.log(`🧲 Enriched Mg for ${mgEnriched} magnesium products`);

    // Re-enrich Turmeric — always re-parse curcuminoids
    let turmericEnriched = 0;
    for (const p of db) {
        if (p.category !== 'Turmeric') continue;
        const freshCurc = parseCurcuminoids(p.title);
        if (freshCurc !== p.turmericCurcuminoids) {
            p.turmericCurcuminoids = freshCurc;
            p.pricePer100mgCurcuminoids = null;
        }
        if (p.turmericCurcuminoids > 0) {
            turmericEnriched++;
            if (!p.pricePer100mgCurcuminoids && p.servingsDeclared && p.priceListed) {
                p.pricePer100mgCurcuminoids = Math.round((p.priceListed / (p.turmericCurcuminoids * p.servingsDeclared / 100)) * 100) / 100;
            }
        } else {
            p.pricePer100mgCurcuminoids = null;
        }
        // BioPerine-Free: Turmeric product with no piperine/black pepper in title
        const hasPiperine = /bioperine|\bpiperine\b|\bblack\s*pepper\b/i.test(p.title);
        const claimsSet = new Set(p.claims || []);
        if (!hasPiperine) {
            claimsSet.add('BioPerine-Free');
        } else {
            claimsSet.delete('BioPerine-Free');
        }
        p.claims = [...claimsSet];
    }
    if (turmericEnriched > 0) console.log(`🌿 Enriched curcuminoids for ${turmericEnriched} turmeric products`);

    // Re-enrich Zinc — always re-parse mg + form + With Copper / Copper-Free / Zinc Lozenge
    let zincEnriched = 0;
    for (const p of db) {
        if (p.category !== 'Zinc') continue;
        const freshZinc = parseZincMg(p.title);
        const freshForm = parseZincForm(p.title);
        if (freshZinc !== p.zincMg || freshForm !== p.zincForm) {
            p.zincMg = freshZinc;
            p.zincForm = freshForm;
            p.pricePer10mgZinc = null;
        }
        if (p.zincMg > 0) {
            zincEnriched++;
            if (!p.pricePer10mgZinc && p.servingsDeclared && p.priceListed) {
                p.pricePer10mgZinc = Math.round((p.priceListed / (p.zincMg * p.servingsDeclared / 10)) * 100) / 100;
            }
        } else {
            p.pricePer10mgZinc = null;
        }
        // With Copper / Copper-Free (safety filter: zinc depletes copper at high doses)
        const hasCopper = /\bcopper\b/i.test(p.title);
        const claimsSet = new Set(p.claims || []);
        if (hasCopper) {
            claimsSet.add('With Copper');
            claimsSet.delete('Copper-Free');
        } else {
            claimsSet.add('Copper-Free');
            claimsSet.delete('With Copper');
        }
        // Zinc Lozenge format tag
        if (/\blozenges?\b/i.test(p.title)) {
            claimsSet.add('Zinc Lozenge');
        } else {
            claimsSet.delete('Zinc Lozenge');
        }
        p.claims = [...claimsSet];
    }
    if (zincEnriched > 0) console.log(`🔵 Enriched Zinc for ${zincEnriched} zinc products`);

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
