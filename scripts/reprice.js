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
// Text in these is code or markup, never a price (e.g. "$1" in a shell snippet)
const nonPriceContainers = 'pre, code, kbd, samp, script, style, textarea';
const hiddenTextContainers = 'script, style, noscript, template';

// Checkout summaries list the tax and a total that already includes it, so
// those amounts are left alone instead of being taxed a second time (#15)
const LABEL_MAX_CHARS = 40; // longer text is a sentence, not a line label
const ROW_MAX_CHARS = 80; // a single "label: amount" line
const SUMMARY_MAX_CHARS = 1000; // a whole subtotal/tax/total block
const taxWordRegex = /\b(?:tax(?:es)?|gst|hst|pst|qst|rst|vat)\b/i;
// e.g. "Total before tax", "Taxes calculated at checkout"
const notTaxLineRegex = /\b(?:before|excl\w*|calculated|not included|free)\b/i;
// e.g. "Total (taxes included)", "incl. VAT", "Prices include all taxes"
const taxIncludedRegex = /\b(?:tax(?:es)?|vat|gst|hst)\s+(?:incl(?:uded|usive|\.)?|incluses)|\bincl(?:udes?|uded|uding|\.)?\s+(?:all\s+(?:applicable\s+)?)?(?:tax(?:es)?|vat|gst|hst)\b|\bTTC\b/i;
const totalLabelRegex = /^\W*(?:order\s+|grand\s+|estimated\s+|final\s+)?total\b/i;
const priceInTextRegex = /[$€£]\s*\d|\b(?:USD|EUR|CAD)\s*\d|\d\s*(?:[$€£]|(?:USD|EUR|CAD)\b)/g;
// Text that could be all or part of a price
const pricePieceRegex = /\d|[$€£]|\b(?:USD|EUR|CAD)\b/;

let currentRate = 1;
/** @type {HTMLElement[]} Checkout summaries whose amounts already include tax */
let taxSummaries = [];

const isTaxLine = (text) => text.length <= LABEL_MAX_CHARS && taxWordRegex.test(text)
    && !notTaxLineRegex.test(text) && !taxIncludedRegex.test(text);

// "Total taxes" is a tax line, but "Total (taxes included)" is the grand total
const isGrandTotal = (text) => text.length <= LABEL_MAX_CHARS && totalLabelRegex.test(text)
    && (!taxWordRegex.test(text) || taxIncludedRegex.test(text));

/**
 * Collects the trimmed, non-empty visible text pieces under an element
 * @param {HTMLElement} el
 * @param {number} maxChars Stop once the combined length passes this
 * @returns {?string[]} The text pieces, or null if longer than maxChars
 */
const visibleTexts = (el, maxChars) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, (node) =>
        node.parentElement?.closest(hiddenTextContainers)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT
    );
    const texts = [];
    let length = 0;
    let node;
    while (node = walker.nextNode()) {
        const text = node.nodeValue.trim();
        if (!text) continue;
        length += text.length;
        if (length > maxChars) return null;
        texts.push(text);
    }
    return texts;
}

/**
 * Finds checkout summaries: compact blocks with a tax line, a grand total,
 * and the amounts for them (e.g. Items / Shipping / Estimated GST / Order Total)
 * @returns {HTMLElement[]}
 */
const findTaxSummaries = () => {
    const summaries = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
        if (!isTaxLine(node.nodeValue.trim())) continue;
        if (node.parentElement?.closest(hiddenTextContainers)) continue;

        // Climb until the block also holds the total and its amounts, which
        // may sit in a sibling column rather than next to each label
        for (let el = node.parentElement; el && el !== document.documentElement; el = el.parentElement) {
            const texts = visibleTexts(el, SUMMARY_MAX_CHARS);
            if (!texts) break;
            const prices = texts.join(' ').match(priceInTextRegex) || [];
            if (texts.some(isGrandTotal) && prices.length >= 2) {
                summaries.add(el);
                break;
            }
        }
    }
    return [...summaries];
}

/**
 * Whether a price's text node already includes tax: it is inside a checkout
 * summary, on a grand total line of a page with one, or labelled tax-included
 * @param {Node} node
 * @returns {boolean}
 */
const isTaxIncluded = (node) => {
    if (taxSummaries.some(summary => summary.contains(node))) return true;

    for (let el = node.parentElement; el; el = el.parentElement) {
        const texts = visibleTexts(el, ROW_MAX_CHARS);
        if (!texts) return false;
        // Past a second amount this is a list of rows, not this price's line
        if ((texts.join(' ').match(priceInTextRegex) || []).length > 1) return false;
        if (texts.some(text => taxIncludedRegex.test(text))) return true;
        // e.g. Amazon repeats "Order Total" beside the place-order button
        if (taxSummaries.length > 0 && texts.some(isGrandTotal)) return true;
    }
    return false;
}

/**
 * Finds the page's checkout summaries again and puts back any amounts that
 * were taxed before the site rendered the summary they belong to
 */
const refreshTaxSummaries = () => {
    taxSummaries = findTaxSummaries();
    originalValues.forEach((originalText, node) => {
        if (!node.isConnected || !isTaxIncluded(node)) return;
        node.nodeValue = originalText;
        originalValues.delete(node);
        processedTextNodes.delete(node);
    });
}

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

        let parsed = amountStrToFloat(amountStr, decimalSep, thousandSep);
        if (!parsed) return match;

        const [whole, fraction] = splitCalculateNumber(parsed, activeRate);

        const formattedIntegers = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep || '');
        // Fall back to a decimal separator distinct from the thousands one
        // (e.g. a "1.234" whole amount uses "." for grouping, so cents need ",")
        const finalDecimalSep = decimalSep ?? (thousandSep === '.' ? ',' : '.');
        const finalAmount = `${formattedIntegers}${finalDecimalSep}${fraction}`;

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
            // whole is already processed in the big regex; whitespace-only
            // nodes between the symbol and the amount keep the state alive
            if (sepPrice.whole) sepPrice.state = PriceStates.WHOLE;
            else if (text.trim().length > 0) resetSepPrice(sepPrice);
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

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, (node) => {
        if (processedTextNodes.has(node)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest(nonPriceContainers)) return NodeFilter.FILTER_REJECT;
        // Skip the currency symbol too, so it can't pair with a later number
        if (pricePieceRegex.test(node.nodeValue) && isTaxIncluded(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
    });
    let textNode;
    let modified = false;
    const elemInitialHtml = element.innerHTML;

    /**
     * Tracks price data spanning multiple text nodes. Starts EMPTY so bare
     * numbers (token counts, timings, ratings) are never treated as prices
     * until a real currency symbol is seen.
     */
    let sepPrice = {
        /** @type {?PricePart} */
        whole: null,
        /** @type {?PricePart} */
        fraction: null,
        /** @type {PriceStates} */
        state: PriceStates.EMPTY,
    };
    
    while (textNode = walker.nextNode()) {
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

        refreshTaxSummaries();
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

    // Before the popup ever saves, show the same default rate it displays
    currentRate = getCombinedRate(getRatesOrDefault(sync.rates));

    resetPrices(); // avoid double calculations

    const siteDisabled = (sync.disabledSites || []).includes(location.hostname);
    const isEnabled = local.taxOn !== false && !siteDisabled; // taxOn true if undefined
    if (isEnabled) {
        refreshTaxSummaries();
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
            const target = mutation.target.nodeType === Node.TEXT_NODE
                ? mutation.target.parentElement
                : mutation.target;

            // The site changed this text in place (e.g. a reactive price
            // update), so our processed/original records for it are stale
            if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
                processedTextNodes.delete(mutation.target);
                originalValues.delete(mutation.target);
            }

            // The site changed content under an element we marked as
            // processed; clear the marker so the new content gets calculated
            if (target && target.closest) {
                const modifiedElement = target.closest('[data-original-html]');
                if (modifiedElement) {
                    delete modifiedElement.dataset.originalHtml;
                }
            }

            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        nodesToProcess.add(node);
                        shouldProcess = true;
                    }
                });
            } else if (mutation.type === 'childList' || mutation.type === 'characterData') {
                if (target && target.closest) {
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
