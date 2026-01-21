let timeout = null;
const MIN_REFRESH_INTERVAL = 500; // ms
const nodesToProcess = new Set();
const tagsWithPrices = `
  span:not(script span, style span), div:not(nav div), 
  p, li, article, section, h1, h2, h3, b, i, strong
`;

let currentRate = 1;

function calculatePrice(element, rate) {
  const activeRate = rate || currentRate; 
  if (!activeRate || activeRate === 1) return;
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
      const updatedAmount = (parseFloat(amount.replace(/,/g, '')) * activeRate).toFixed(2);
      return `${currency}${updatedAmount}`;
    });

    if (hasMatches) textNode.nodeValue = newText;
  }

  if (hasMatches) element.dataset.priceProcessed = "true";
}

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
chrome.storage.onChanged.addListener((changes) => {
  if (changes.rates) {
    window.location.reload(); // reload to reset and recalculate
    // ^see if this is annoying or not, could be changed
  }

  if (changes.taxOn) {
    window.location.reload(); // reload to reset and possibly recalculate
  }
});

// =======================================
// ===========   MAIN   ==================
// =======================================

chrome.storage.local.get(['taxOn'], localRes => {
  chrome.storage.sync.get(['rates'], syncRes => {
    const isEnabled = localRes.taxOn !== false; // Default to true if undefined
    currentRate = getCombinedRate(syncRes.rates);

    if (isEnabled) {
      document.querySelectorAll(tagsWithPrices).forEach(el => {
        calculatePrice(el);
      });
    }

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
});


