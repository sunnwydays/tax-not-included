const defaultRates = {
  'Tax': 1.13
}

let rates = {};

const updateTotalDisplay = () => {
  const total = getCombinedRate(rates);
  const display = document.querySelector('#total-rate');
  if (display) {
    display.textContent = `Total Multiplier: x${total.toFixed(4)}`;
  }
};

const rateSubmit = async (e) => {
  e.preventDefault();
  const status = document.querySelector('#save-status');

  await chrome.storage.sync.set({ "rates": rates });

  // Trigger the visual cue
  status.classList.remove('opacity-0');
  
  setTimeout(() => {
    status.classList.add('opacity-0');
  }, 1500);
};

const initPopup = async () => {
  const result = await chrome.storage.sync.get(['rates']);
// Check if result.rates exists, otherwise use defaults
  rates = (result.rates && Object.keys(result.rates).length > 0) 
    ? result.rates 
    : defaultRates;

  const elements = [];

  const rateForm = document.querySelector('#rate-form');
  rateForm.addEventListener("submit", rateSubmit);

  const template = document.getElementById('rate_input_template');

  if (Object.keys(rates).length === 0) rates = defaultRates;

  for (const [rateName, rate] of Object.entries(rates)) {
    const element = template.content.firstElementChild.cloneNode(true);

    const label = element.querySelector('label');
    const input = element.querySelector('input');
    label.textContent = rateName;
    label.setAttribute('for', rateName);
    input.setAttribute('id', rateName);
    input.setAttribute('name', rateName);

    input.addEventListener('input', (e) => {
      const numericValue = parseFloat(e.target.value);
      if (!isNaN(numericValue) && numericValue >= 0) {
        rates[rateName] = numericValue;
        updateTotalDisplay(); 
        input.classList.remove('error');
      } else {
        input.classList.add('error');
      }
    });
    input.value = rate;

    elements.push(element);
  }

  document.querySelector('#rate-form > ul').append(...elements);
  updateTotalDisplay();
}

initPopup();