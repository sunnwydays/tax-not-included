let timeout = null;
const minRefreshInterval = 500; // ms
const nodesToProcess = new Set();
const tagsWithPrices = 'span'; // for now looks like all prices are in spans
// 'p, span, div, li, article, section, h1, h2, h3, b, i, strong'

function calculatePrice(element, rate) {
  if (!rate) return;
  if (!element || element.dataset.priceProcessed || element.closest('[data-price-processed]')) {
    return;
  }

  const priceRegex = /(\$|USD|CAD|€|£)\s?([0-9,]+(\.[0-9,]+)?)/g;
  
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  let textNode;
  let hasMatches = false;

  while (textNode = walker.nextNode()) {
    const originalText = textNode.nodeValue;
    const newText = originalText.replace(priceRegex, (match, currency, amount) => {
      hasMatches = true;
      const updatedAmount = (parseFloat(amount.replace(/,/g, '')) * rate).toFixed(2);
      return `${currency}${updatedAmount}`;
    });

    if (hasMatches) textNode.nodeValue = newText;
  }

  if (hasMatches) element.dataset.priceProcessed = "true";
}

const processBatch = () => {
  nodesToProcess.forEach(node => {
    // Process the root node
    calculatePrice(node);
    // Process all relevant children
    node.querySelectorAll(tagsWithPrices)
        .forEach(calculatePrice);
  });
  nodesToProcess.clear();
};

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
  timeout = setTimeout(processBatch, minRefreshInterval);  
});

// Detect and apply user's rate changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.rates) {
    window.location.reload(); // reload to reset and recalculate
    // ^see if this is annoying or not, could be changed
  }
});

// =======================================
// ===========   MAIN   ==================
// =======================================

// Get the rate before calculating
chrome.storage.sync.get(['rates'], (result) => {
  const currentRate = getCombinedRate(result.rates);

  document.querySelectorAll(tagsWithPrices).forEach(el => {
    calculatePrice(el, currentRate);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
});

