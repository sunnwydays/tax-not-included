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