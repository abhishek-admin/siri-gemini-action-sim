importScripts('gemini.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.removeAll?.(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'callGeminiBackground') {
    callGemini(message.prompt, message.options || {})
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getActiveTabContext') {
    getActiveTabContext()
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'sendToActiveTab') {
    sendToActiveTab(message.payload)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error('No active tab found.');
  if (/^chrome:|^edge:|^about:|^chrome-extension:/i.test(tab.url || '')) {
    throw new Error('Chrome blocks extensions on this page. Try a normal website tab.');
  }
  return tab;
}

async function getActiveTabContext() {
  const tab = await getActiveTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, { action: 'sgasCollectContext' });
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css']
    }).catch(() => {});
    return chrome.tabs.sendMessage(tab.id, { action: 'sgasCollectContext' });
  }
}

async function sendToActiveTab(payload) {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, payload);
}
