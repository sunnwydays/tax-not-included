/**
 * @typedef {Object} PricePart
 * @property {Node|null} node - The DOM text node containing this part.
 * @property {number|null} value - The numeric value.
 * @property {string} [thousandSep] - Thousands separator used (whole only).
 */

/**
 * Enum for price detection state machine.
 * @readonly
 * @enum {number}
 */
const PriceStates = {
    /** No price data detected yet */
    EMPTY: 0,
    /** Currency symbol or code detected (e.g., "$", "USD") */
    CURRENCY: 1,
    /** Integer portion of the price detected */
    WHOLE: 2,
    /** Decimal separator detected */
    DECIMAL: 3,
    /** Full price (Whole + Fraction) captured */
    COMPLETE: 4,
};

let timeout = null;
const MIN_REFRESH_INTERVAL = 500; // ms
const nodesToProcess = new Set();
let processedTextNodes = new WeakSet(); // double-calculation issues if you mark parents instead
const originalValues = new Map(); // text node -> original string, restored on reset
const tagsWithPrices = `
span:not(script span, style span), div:not(nav div), 
p, li, article, section
`;

let currentRate = 1;

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
 * Split a number into its whole and fraction components
 * @param {number} amount Number to be split
 * @param {number} activeRate
 * @returns Array containing the whole portion and fraction portion, as strings
 */
const splitCalculateNumber = (amount, activeRate) => {
    const [whole, fraction] = (amount * activeRate).toFixed(2).split('.');
    return [whole, fraction];
}

/**
 * Parses an amount string into a float
 * @param {string} amountStr Price as a string without leading or trailing symbol
 * @param {string} decimalSep Symbol for decimal separator
 * @returns Float of the amount, or null if unable to be parsed
 */
const amountStrToFloat = (amountStr, decimalSep) => {
    let normalized = amountStr.replace(/[ '\u00A0]/g, '');
    if (decimalSep === ',') {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
        normalized = normalized.replace(/,/g, '');
    }

    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? null : parsed;
}

/**
 * Parse currency, thousands separator, and decimal separator in various formats
 * @param {string} text The text content to find and apply price rate
 * @param {number} activeRate
 * @param {Object} sepPrice - The global price state object (mutated in place).
 * @returns Object with the modified text and hasMatch boolean
 */
const applyRateInText = (text, activeRate, sepPrice, textNode) => {
    const priceRegex = /((?:\b(?:USD|EUR|CAD)|[$€£])\s*)?(\d+(?:[.,'\s\u00A0]\d{3})*(?:[.,]\d{1,2})?)(\s*(?:\b(?:USD|EUR|CAD)|[$€£]))?/g;

    let hasMatch = false;

    const newText = text.replace(priceRegex, (match, leading, amountStr, trailing) => {
        const hasCurrency = leading || trailing;
        const previouslySeenCurrency = sepPrice.state == PriceStates.CURRENCY;
        if (!hasCurrency && !previouslySeenCurrency) return match;

        const [decimalSep, thousandSep] = getAmountSeps(amountStr);

        let parsed = amountStrToFloat(amountStr, decimalSep);
        if (!parsed) return match;

        const [whole, fraction] = splitCalculateNumber(parsed, activeRate);

        const formattedIntegers = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep || '');
        const finalAmount = `${formattedIntegers}${decimalSep ?? "."}${fraction}`;

        if (!hasCurrency && previouslySeenCurrency) {
            if (decimalSep) {
                sepPrice.state = PriceStates.COMPLETE;
            } else {
                sepPrice.whole = { node: textNode, value: parsed, thousandSep };
                return match;
            }
        }
        hasMatch = true;
        return (leading ?? '') + finalAmount + (trailing ?? '');
    });

    return { newText, hasMatch };
}

/**
 * Resets the price state object to its initial empty state.
 * * Note: This function mutates the original object by reference.
 * * @param {Object} obj - The price state object to be cleared.
 * @param {PricePart} obj.whole - The integer part to reset.
 * @param {PricePart} obj.fraction - The decimal part to reset.
 * @param {number} obj.state - The state to return to {@link PriceStates.EMPTY}.
 */
const resetSepPrice = (obj) => {
    obj.whole = null;
    obj.fraction = null;
    obj.state = PriceStates.EMPTY;
};

/**
 * Updates the price state machine based on the content of the current text node.
 * Handles prices spanning multiple nodes by tracking state transitions.
 * * @param {string} text - The text content of the current node to analyze.
 * @param {Node} textNode - The DOM text node currently being processed.
 * @param {Object} sepPrice - The global price state object (mutated in place).
 */
const processSepPrice = (text, textNode, sepPrice) => {
    // Node might contain a part of the price string, save and check neighbours
    const currencies = /^(?:USD|EUR|CAD|[$€£])$/;
    const currencyMatch = text.match(currencies);

    if (currencyMatch) {
        sepPrice.state = PriceStates.CURRENCY;
    } else {
        if (sepPrice.state == PriceStates.CURRENCY) {
            // whole is already processed in the big regex
            if (sepPrice.whole) sepPrice.state = PriceStates.WHOLE;
            else resetSepPrice(sepPrice);
        } else if (sepPrice.state == PriceStates.WHOLE) {
            const decimalRegex = /[.,]/;
            if (decimalRegex.test(text)) sepPrice.state++;
            else sepPrice.state = PriceStates.COMPLETE;
        } else if (sepPrice.state == PriceStates.DECIMAL) {
            const match = text.match(/^(\d{2})\s*$/);
            if (match) {
                sepPrice.fraction = {
                    node: textNode,
                    value: parseInt(match[1]) 
                };
            }
            sepPrice.state = PriceStates.COMPLETE;
        } else {
            // If it's not a currency and not a part of the number
            if (text.trim().length > 0) resetSepPrice(sepPrice);
        }
    }
}

/**
 * Calculates the converted price and updates the associated DOM text nodes.
 * * @param {Object} sepPrice - The state object containing price parts and nodes.
 * @param {PricePart} sepPrice.whole - The integer part of the price.
 * @param {PricePart} [sepPrice.fraction] - The decimal part of the price.
 * @param {number} sepPrice.state - The current state from {@link PriceStates}.
 * @param {number} activeRate 
 */
const applySepPrice = (sepPrice, activeRate) => {
    let total = 0;
    // whole value may not exist if already processed by big regex 
    if (sepPrice.whole?.value) total += sepPrice.whole.value;
    if (sepPrice.fraction?.value) total += sepPrice.fraction.value / 100;

    const [whole, fraction] = splitCalculateNumber(total, activeRate);
    const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, sepPrice.whole?.thousandSep || '');
    
    if (sepPrice.whole?.node) {
        if (!originalValues.has(sepPrice.whole.node)) {
            originalValues.set(sepPrice.whole.node, sepPrice.whole.node.nodeValue);
        }
        sepPrice.whole.node.nodeValue = formattedWhole;
    }
    if (sepPrice.fraction?.node) {
        if (!originalValues.has(sepPrice.fraction.node)) {
            originalValues.set(sepPrice.fraction.node, sepPrice.fraction.node.nodeValue);
        }
        sepPrice.fraction.node.nodeValue = fraction;
    }
}

/**
 * Calculates and updates the price display on page for a DOM element and its
 * children (only including children tagsWithPrices)
 * @param {HTMLElement} element 
 * @param {number} rate 
 * @returns 
 */
const calculatePrice = (element, rate) => {
    const activeRate = rate || currentRate; 
    if (!activeRate || activeRate === 1 || !element) return;
    if (element.closest('[data-original-html]')) return;

    // If the site changed the HTML (e.g., color swap), we should strip our marker and re-process.
    if (element.dataset.originalHtml) {
        if (element.innerHTML.includes(element.dataset.originalHtml)) return;
        delete element.dataset.originalHtml;
    }

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    let modified = false;
    const elemInitialHtml = element.innerHTML;

    /**
     * Tracks price data spanning multiple text nodes.
     */
    let sepPrice = {
        /** @type {PricePart} */
        whole: { node: null, value: null, thousandSep: "" },
        /** @type {PricePart} */
        fraction: { node: null, value: null },
        /** @type {PriceStates} */
        state: PriceStates.CURRENCY,
    };
    
    while (textNode = walker.nextNode()) {
        if (processedTextNodes.has(textNode)) continue;
        processedTextNodes.add(textNode);

        const originalText = textNode.nodeValue;
        const { newText, hasMatch } = applyRateInText(originalText, activeRate, sepPrice, textNode);

        if (hasMatch) {
            // Node contains the whole price string
            if (!originalValues.has(textNode)) originalValues.set(textNode, originalText);
            textNode.nodeValue = newText;
            modified = true;
        } else {
            // Node might contain a part of the price string, save and check neighbours
            const currencies = /^(?:USD|EUR|CAD|[$€£])$/;
            const currencyMatch = originalText.match(currencies);

            if (currencyMatch) sepPrice.state = PriceStates.CURRENCY;
            else processSepPrice(originalText, textNode, sepPrice);
        }

        if (sepPrice.state >= PriceStates.COMPLETE) {
            applySepPrice(sepPrice, activeRate);
            resetSepPrice(sepPrice);
            modified = true;
        }
    }

    if (modified) element.dataset.originalHtml = elemInitialHtml;
}

let observer = null; 

const startObserving = () => {
    if (!observer) return;
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
};

/**
 * Calculates and updates prices for a set of elements (nodesToPrices) if taxOn
 */
const processBatch = () => {
    Promise.all([
        chrome.storage.local.get(['taxOn']),
        chrome.storage.sync.get(['disabledSites'])
    ]).then(([local, sync]) => {
        const siteDisabled = (sync.disabledSites || []).includes(location.hostname);
        if (local.taxOn === false || siteDisabled || nodesToProcess.size === 0) {
            nodesToProcess.clear();
            return;
        }

        if (observer) observer.disconnect(); 

        nodesToProcess.forEach(node => {
            calculatePrice(node);
        });
        
        nodesToProcess.clear();
        startObserving(); 
    });
};

/**
 * Reset prices in the DOM to their original values
 */
const resetPrices = () => {
    if (observer) observer.disconnect();
    clearTimeout(timeout);
    nodesToProcess.clear();

    // Restore each text node we modified; nodes the site has since replaced
    // (e.g. on a colour/style swap) are disconnected and skipped, so stale
    // markup is never re-injected
    originalValues.forEach((originalText, node) => {
        if (node.isConnected) node.nodeValue = originalText;
    });
    originalValues.clear();

    document.querySelectorAll('[data-original-html]').forEach(el => {
        delete el.dataset.originalHtml;
    });

    processedTextNodes = new WeakSet();
}

/**
 * Change prices on the page to reflect user's rates
 */
const applyRates = async () => {
    const [local, sync] = await Promise.all([
        chrome.storage.local.get(['taxOn']),
        chrome.storage.sync.get(['rates', 'disabledSites'])
    ]);

    currentRate = getCombinedRate(sync.rates || {});

    resetPrices(); // avoid double calculations

    const siteDisabled = (sync.disabledSites || []).includes(location.hostname);
    const isEnabled = local.taxOn !== false && !siteDisabled; // taxOn true if undefined
    if (isEnabled) {
        document.querySelectorAll(tagsWithPrices).forEach(el => {
            calculatePrice(el);
        });
        // resetPrices disconnected the observer; reconnect so dynamically
        // added prices (SPAs, lazy loading) keep being processed
        startObserving();
    }
}

/**
 * Create observer and listener for changes in DOM and rates
 */
const initializeObservers = () => {
    let lastUrl = location.href;

    // Detect (for SPAs) and batch price changes, min time between refreshes
    observer = new MutationObserver((mutations) => {
        // Clear node visited statuses on URL change in SPAs
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            processedTextNodes = new WeakSet();
            applyRates();
            return;
        }

        let shouldProcess = false;

        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        nodesToProcess.add(node);
                        shouldProcess = true;
                    }
                });
            } else if (mutation.type === 'childList' || mutation.type === 'characterData') {
                const target = mutation.target.nodeType === Node.TEXT_NODE 
                    ? mutation.target.parentElement 
                    : mutation.target;

                if (target && target.closest) {
                    const modifiedElement = target.closest('[data-original-html]');
                    
                    if (modifiedElement) {
                        delete modifiedElement.dataset.originalHtml;
                    }

                    const relevantParent = target.closest(tagsWithPrices) || target;
                    nodesToProcess.add(relevantParent);
                    shouldProcess = true;
                }
            }
        }
        
        if (shouldProcess) {
            clearTimeout(timeout);
            timeout = setTimeout(processBatch, MIN_REFRESH_INTERVAL);
        }
    });

    startObserving();

    // Detect and apply changes to rates, the tax toggle, or disabled sites.
    // applyRates resets first and only recalculates when enabled here, so it
    // covers both directions
    chrome.storage.onChanged.addListener(async (changes) => {
        if (changes.taxOn || changes.rates || changes.disabledSites) {
            await applyRates();
        }
    });
}

applyRates();
initializeObservers();
