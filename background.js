chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-tax') {
        const result = await chrome.storage.local.get(['taxOn']);
        const newState = (result.taxOn === undefined) ? false : !result.taxOn;

        await chrome.storage.local.set({ 'taxOn': newState });
    }
});

// Without a tabId this sets the badge every tab falls back to
const updateBadge = async (isOn, tabId) => {
	await chrome.action.setBadgeBackgroundColor({ color: isOn ? '#54b840' : '#d98071', tabId });
    await chrome.action.setBadgeText({ text: isOn ? 'ON' : 'OFF', tabId });
};

// Badge text isn't kept across browser restarts, so set it from storage
const syncBadge = async () => {
	const { taxOn } = await chrome.storage.local.get(['taxOn']);
	await updateBadge(taxOn !== false); // taxOn true if undefined
};

// onInstalled also fires on extension and browser updates; only the first
// install should turn tax on, so an update keeps the user's choice
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
	if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
		await chrome.storage.local.set({ 'taxOn': true });
	}
	await syncBadge();
});

chrome.runtime.onStartup.addListener(syncBadge);

chrome.storage.onChanged.addListener(async (changes, namespace) => {
	if (namespace === 'local' && changes.taxOn) {
		await updateBadge(changes.taxOn.newValue);
	}
});

// Pages report whether they are changing prices, which is OFF on sites the
// extension is disabled for even while it is on everywhere else
chrome.runtime.onMessage.addListener((message, sender) => {
	if (message?.type === 'pageState' && sender.tab?.id !== undefined) {
		updateBadge(message.enabled, sender.tab.id);
	}
});
