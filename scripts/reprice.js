let timeout = null;
const MIN_REFRESH_INTERVAL = 500; // ms
const nodesToProcess = new Set();
const tagsWithPrices = `
span:not(script span, style span), div:not(nav div), 
p, li, article, section, h1, h2, h3, b, i, strong
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
    
    const priceRegex = /(\$|USD|CAD|€|£)\s?([0-9,]+(\.[0-9,]+)?)/g;
    
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    let modified = false;
    const elemInitialHtml = element.innerHTML;
    
    while (textNode = walker.nextNode()) {
        let hasMatch = false;
        const originalText = textNode.nodeValue;
        const newText = originalText.replace(priceRegex, (match, currency, amount) => {
            modified = true;
            hasMatch = true;
            const updatedAmount = (parseFloat(amount.replace(/,/g, '')) * activeRate).toFixed(2);
            return `${currency}${updatedAmount}`;
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
