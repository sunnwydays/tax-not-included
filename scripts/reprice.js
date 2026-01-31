let timeout = null;
const MIN_REFRESH_INTERVAL = 500; // ms
const nodesToProcess = new Set();
const tagsWithPrices = `
span:not(script span, style span), div:not(nav div), 
p, li, article, section
`;

let currentRate = 1;

/**
 * Calculates and updates the price display on page for a DOM element and its
 * children (only including children tagsWithPrices)
 * @param {HTMLElement} element 
 * @param {number} rate 
 * @returns 
 */
const calculatePrice = (element, rate) => {
    const activeRate = rate || currentRate; 
    if (!activeRate || activeRate === 1) return;
    if (!element || element.dataset.originalText || element.closest('[data-original-html]')) {
        return;
    }
    
    // 1. Leading Symbol (Optional)
    // 2. Number (Mandatory: >1 digits + optional thousands + optional 2-digit decimal)
    // 3. Trailing Symbol (Optional)
    const priceRegex = /((?:\b(?:USD|EUR|CAD)|[$€£])\s*)?(\d+(?:[.,'\s\u00A0]\d{3})*(?:[.,]\d{1,2})?)(\s*(?:\b(?:USD|EUR|CAD)|[$€£]))?/g;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    let modified = false;
    const elemInitialHtml = element.innerHTML;
    
    while (textNode = walker.nextNode()) {
        const originalText = textNode.nodeValue;

        let hasMatch = false;

        // parse currency, thousands separator, and decimal separator in various formats
        const newText = originalText.replace(priceRegex, (match, leading, amountStr, trailing) => {
            if (!leading && !trailing) return match;

            const possibleDecimalSeps = ['.', ','];

            let decimalSep = null;
            const charAt_2 = amountStr.at(-2);
            const charAt_3 = amountStr.at(-3);

            if (possibleDecimalSeps.includes(charAt_2)) decimalSep = charAt_2;
            else if (possibleDecimalSeps.includes(charAt_3)) decimalSep = charAt_3;

            const allSeps = amountStr.match(/[.,'\s\u00A0]/g) || [];
            const thousandSep = allSeps.find((s) => {
                return s !== decimalSep;
            }) || null;

            let normalized = amountStr.replace(/[ '\u00A0]/g, '');
            if (decimalSep === ',') {
                normalized = normalized.replace(/\./g, '').replace(',', '.');
            } else {
                normalized = normalized.replace(/,/g, '');
            }

            const parsed = parseFloat(normalized);
            if (isNaN(parsed)) return match;

            const updatedValue = (parsed * activeRate).toFixed(2);
            const [integers, decimals] = updatedValue.split('.');

            // Add thousand separators back
            const formattedIntegers = integers.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep || '');
            
            // Put it all together using the original decimal separator
            const finalAmount = decimalSep 
                ? `${formattedIntegers}${decimalSep}${decimals}` 
                : formattedIntegers;

            hasMatch = true;
            modified = true;
            return (leading ?? '') + finalAmount + (trailing ?? '');
        });

        if (hasMatch) textNode.nodeValue = newText;
    }

    if (modified) {
        // Save the original state of the node for reset
        element.dataset.originalHtml = elemInitialHtml;
    }
}

/**
 * Calculates and updates prices for a set of elements (nodesToPrices) if taxOn
 */
const processBatch = () => {
    chrome.storage.local.get(['taxOn'], (res) => {
        if (res.taxOn === false) {
            nodesToProcess.clear();
            return;
        }
        
        nodesToProcess.forEach(node => {
            calculatePrice(node);
            node.querySelectorAll(tagsWithPrices).forEach(calculatePrice);
        });
        nodesToProcess.clear();
    });
};

/**
 * Reset prices in the DOM to their original values
 */
const resetPrices = () => {
    document.querySelectorAll('[data-original-html').forEach(el => {
        el.innerHTML = el.dataset.originalHtml;
        delete el.dataset.originalHtml;
    });
}

/**
 * Change prices on the page to reflect user's rates
 */
const applyRates = async () => {
    const [local, sync] = await Promise.all([
        chrome.storage.local.get(['taxOn']),
        chrome.storage.sync.get(['rates'])
    ]);

    currentRate = getCombinedRate(sync.rates || {});

    const isEnabled = local.taxOn !== false; // True if undefined
    if (isEnabled) {
        document.querySelectorAll(tagsWithPrices).forEach(el => {
            calculatePrice(el);
        });
    }
}

/**
 * Create observer and listener for changes in DOM and rates
 */
const initializeObservers = () => {
    // Detect (for SPAs) and batch price changes, min time between refreshes
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    nodesToProcess.add(node);
                }
            });
        }
        
        clearTimeout(timeout);
        timeout = setTimeout(processBatch, MIN_REFRESH_INTERVAL);  
    });

    // Detect and apply user's rate changes
    chrome.storage.onChanged.addListener(async (changes) => {
        if (changes.taxOn) {
            const isTaxOn = changes.taxOn.newValue;
            if (isTaxOn) applyRates();
            else resetPrices();
        }

        // Also handle rate changes if the tax is currently active
        if (changes.rates) {
            const { taxOn } = await chrome.storage.local.get(['taxOn']);
            if (taxOn !== false) {
                resetPrices();
                applyRates();
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

applyRates();
initializeObservers();