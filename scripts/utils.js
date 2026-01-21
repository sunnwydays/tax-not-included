const getCombinedRate = ratesObj => {
    if (!ratesObj) return 1;
    return Object.values(ratesObj).reduce((acc, rate) => {
        if (!rate) return acc;
        return acc * rate;
    }, 1);
}