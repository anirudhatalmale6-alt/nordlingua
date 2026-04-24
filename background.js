const DEFAULT_SETTINGS = {
  apiKey: '',
  language: 'sv',
  autoCheck: true,
  checkDelay: 1500,
  tone: 'neutral',
  enabled: true
};

const API_BASE = 'https://skylarkmedia.se/ord/api';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('settings', (data) => {
    if (!data.settings) {
      chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    }
  });

  chrome.contextMenus.create({
    id: 'ord-check',
    title: 'Ord: Check grammar',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'ord-rephrase',
    title: 'Ord: Rephrase',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'ord-formal',
    title: 'Ord: Make formal',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'ord-casual',
    title: 'Ord: Make casual',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.selectionText) return;
  const action = info.menuItemId.replace('ord-', '');
  chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_ACTION', action, text: info.selectionText });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHECK_GRAMMAR') {
    handleGrammarCheck(msg.text, msg.language).then(sendResponse);
    return true;
  }
  if (msg.type === 'REPHRASE') {
    handleRephrase(msg.text, msg.language, msg.style).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.sync.get('settings', (data) => {
      sendResponse(data.settings || DEFAULT_SETTINGS);
    });
    return true;
  }
});

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get('settings', (data) => {
      resolve(data.settings || DEFAULT_SETTINGS);
    });
  });
}

async function callOrdAPI(endpoint, body) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    return { error: 'API key not configured. Click the Ord icon to set up.' };
  }

  try {
    const resp = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { error: data.error || `Server error: ${resp.status}` };
    }
    return data;
  } catch (e) {
    return { error: 'Network error: ' + e.message };
  }
}

async function handleGrammarCheck(text, language) {
  return callOrdAPI('/check', { text, language });
}

async function handleRephrase(text, language, style) {
  return callOrdAPI('/rephrase', { text, language, style });
}
