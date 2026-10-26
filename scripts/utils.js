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