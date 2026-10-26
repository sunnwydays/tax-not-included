/** * @type {Object.<string, number>}
 * @description Default tax rates used until the user saves their own.
 */
const defaultRates = { 'Tax': 1.13 };

/**
 * Multiplier used on sites marked as grocery stores; 1 means exempt.
 * A number rather than a switch so reduced grocery taxes can be modelled.
 * @type {number}
 */
const defaultGroceryRate = 1;

/**
 * Returns the saved rates, or the defaults if none have been saved yet
 * @param {?Object.<string, number>} savedRates Rates from chrome.storage.sync
 * @returns {Object.<string, number>} A copy, safe to modify
 */
const getRatesOrDefault = savedRates => {
    const hasRates = savedRates && Object.keys(savedRates).length > 0;
    return { ...(hasRates ? savedRates : defaultRates) };
}

/**
 * Returns the cumulative rate
 * @param {Object.<string, number>} ratesObj Object of rate names and rates
 * @returns {number} Product of all rates
 */
const getCombinedRate = ratesObj => {
    if (!ratesObj) return 1;
    return Object.values(ratesObj).reduce((acc, rate) => {
        if (!rate) return acc;
        return acc * rate;
    }, 1);
}

/**
 * Rounds to the nearest cent, with halves rounding up. Float noise is removed
 * first, so 10.50 x 1.13 (11.864999...) rounds to 11.87 rather than 11.86
 * @param {number} amount
 * @returns {string} The amount with two decimals, e.g. "11.87"
 */
const toCents = amount => (Math.round(Number((amount * 100).toPrecision(12))) / 100).toFixed(2);

/**
 * Returns the decimal and thousands separators for a price amount
 * @param {string} amountStr Price as a string without leading or trailing symbol
 * @returns Symbol for decimal separator (or null) and for thousands separator (or null) as array
 */
const getAmountSeps = (amountStr) => {
    const possibleDecimalSeps = ['.', ','];
    const allSeps = amountStr.match(/[.,'\s\u00A0]/g) || [];

    let decimalSep = null;
    const charAt_2 = amountStr.at(-2);
    const charAt_3 = amountStr.at(-3);
    if (possibleDecimalSeps.includes(charAt_2)) decimalSep = charAt_2;
    else if (possibleDecimalSeps.includes(charAt_3)) decimalSep = charAt_3;

    const thousandSep = allSeps.find((s) => { return s !== decimalSep; }) || null;

    return [decimalSep, thousandSep];
}

/**
 * Parses an amount string into a float
 * @param {string} amountStr Price as a string without leading or trailing symbol
 * @param {string} decimalSep Symbol for decimal separator
 * @param {string} thousandSep Symbol for thousands separator
 * @returns Float of the amount, or null if unable to be parsed
 */
const amountStrToFloat = (amountStr, decimalSep, thousandSep) => {
    let normalized = amountStr.replace(/[ '\u00A0]/g, '');
    // Strip the thousands separator wherever it lands (e.g. "1.234" meaning
    // 1234), since without this a lone "." grouping with no decimal part
    // (common outside the US) is left in place and misread as a decimal point
    if (thousandSep) normalized = normalized.split(thousandSep).join('');
    if (decimalSep === ',') normalized = normalized.replace(',', '.');

    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? null : parsed;
}

/**
 * Creates the regex for a price amount with a leading or trailing currency
 * (a fresh one each time, since a global regex keeps state between uses)
 * @returns {RegExp} Groups: leading currency, amount, trailing currency
 */
const createPriceRegex = () =>
    /((?:\b(?:USD|EUR|CAD)|[$€£])\s*)?(\d+(?:[.,'\s\u00A0]\d{3})*(?:[.,]\d{1,2})?)(\s*(?:\b(?:USD|EUR|CAD)|[$€£]))?/g;

/**
 * Formats an amount rounded to cents, with the given separators
 * @param {number} amount
 * @param {?string} thousandSep Grouping separator, or null for none
 * @param {?string} decimalSep Decimal separator, or null to pick one that
 *   differs from the thousands separator (a "1.234" amount needs "," for cents)
 * @returns {string} e.g. "1,234.50" or "1.234,50"
 */
const formatAmount = (amount, thousandSep, decimalSep) => {
    const [whole, fraction] = toCents(amount).split('.');
    const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep || '');
    return `${groupedWhole}${decimalSep ?? (thousandSep === '.' ? ',' : '.')}${fraction}`;
}

/**
 * @typedef {Object} ParsedPrice
 * @property {number} value
 * @property {?string} decimalSep
 * @property {?string} thousandSep
 * @property {string} leading - Currency (and spacing) before the amount
 * @property {string} trailing - Currency (and spacing) after the amount
 */

/**
 * Finds the first price with a currency in a piece of text
 * @param {string} text
 * @returns {?ParsedPrice} null if the text holds no price
 */
const parsePriceText = text => {
    for (const [, leading, amountStr, trailing] of text.matchAll(createPriceRegex())) {
        if (!leading && !trailing) continue;
        const [decimalSep, thousandSep] = getAmountSeps(amountStr);
        const value = amountStrToFloat(amountStr, decimalSep, thousandSep);
        if (!value) continue;
        return { value, decimalSep, thousandSep, leading: leading ?? '', trailing: trailing ?? '' };
    }
    return null;
}

// Quantity in a product title, e.g. "435 g", "1,5 L", "6 x 355 mL", "12 × 30 g"
const quantityRegex = /(?<![\d.,])(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz|kg|mg|g|ml|cl|l|lbs?|oz)\b/i;
// Count packs, e.g. "24 ct", "12 pack"
const countRegex = /(?<![\d.,])(\d+)\s*(?:ct|count|pack|pk)\b/i;
// A unit price already on the page, e.g. "$1.26/100 g", "$2.99 / lb", "$4 per kg"
const unitPriceRegex = /\/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:kg|mg|g|ml|cl|l|lbs?|oz|ea|each|ct|unit)\b|\bper\s+(?:\d+(?:[.,]\d+)?\s*)?(?:kg|mg|g|ml|cl|l|lbs?|oz|ea|each|unit|item)\b/i;

// Quantity unit -> [normalised unit, factor to it]
const quantityUnits = {
    mg: ['g', 0.001], g: ['g', 1], kg: ['g', 1000],
    ml: ['mL', 1], cl: ['mL', 10], l: ['mL', 1000],
    lb: ['lb', 1], lbs: ['lb', 1], oz: ['oz', 1], floz: ['fl oz', 1],
};

/**
 * What unit prices are quoted per, by normalised unit. Metric is per 100,
 * everything else per single unit.
 * @type {Object.<string, {size: number, label: string}>}
 */
const unitPriceBases = {
    g: { size: 100, label: '100 g' },
    mL: { size: 100, label: '100 mL' },
    lb: { size: 1, label: 'lb' },
    oz: { size: 1, label: 'oz' },
    'fl oz': { size: 1, label: 'fl oz' },
    ea: { size: 1, label: 'ea' },
};

/**
 * Finds the quantity a product title gives. Multipacks are multiplied out,
 * and "," or "." may be the decimal separator
 * @param {string} text
 * @returns {?{amount: number, unit: string}} Amount in g, mL, lb, oz, fl oz or
 *   ea (a count of items), or null if there is no quantity
 */
const parseQuantity = text => {
    const match = text.match(quantityRegex);
    if (match) {
        const [, packs, size, rawUnit] = match;
        const [unit, factor] = quantityUnits[rawUnit.toLowerCase().replace(/[\s.]/g, '')];
        const amount = (packs ? parseInt(packs) : 1) * parseFloat(size.replace(',', '.')) * factor;
        return amount > 0 ? { amount, unit } : null;
    }
    const count = text.match(countRegex);
    return count && parseInt(count[1]) > 0 ? { amount: parseInt(count[1]), unit: 'ea' } : null;
}

/**
 * Whether the text already shows a unit price
 * @param {string} text
 * @returns {boolean}
 */
const hasUnitPrice = text => unitPriceRegex.test(text);

/**
 * Formats the price per unit of a quantity, in the style of the source price
 * @param {ParsedPrice} price The price of the whole quantity
 * @param {{amount: number, unit: string}} quantity From {@link parseQuantity}
 * @returns {string} e.g. "$1.26/100 g" or "1,26 €/100 g"
 */
const formatUnitPrice = (price, quantity) => {
    const { size, label } = unitPriceBases[quantity.unit];
    const perUnit = formatAmount(price.value / quantity.amount * size, null, price.decimalSep
        ?? (price.thousandSep === '.' ? ',' : '.'));
    return `${price.leading}${perUnit}${price.trailing}/${label}`;
}
