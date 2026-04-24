const DEFAULT_SETTINGS = {
  apiKey: '',
  language: 'sv',
  autoCheck: true,
  checkDelay: 1500,
  tone: 'neutral',
  enabled: true
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('settings', (data) => {
    if (!data.settings) {
      chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    }
  });

  chrome.contextMenus.create({
    id: 'nordlingua-check',
    title: 'NordLingua: Check grammar',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'nordlingua-rephrase',
    title: 'NordLingua: Rephrase',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'nordlingua-formal',
    title: 'NordLingua: Make formal',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'nordlingua-casual',
    title: 'NordLingua: Make casual',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.selectionText) return;
  const action = info.menuItemId.replace('nordlingua-', '');
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

async function callClaudeAPI(systemPrompt, userContent) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    return { error: 'API key not configured. Click the NordLingua icon to set up.' };
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return { error: err.error?.message || `API error: ${resp.status}` };
    }

    const data = await resp.json();
    return { result: data.content[0].text };
  } catch (e) {
    return { error: 'Network error: ' + e.message };
  }
}

const LANG_NAMES = {
  sv: 'Swedish', en: 'English', no: 'Norwegian', da: 'Danish', fi: 'Finnish',
  de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', pl: 'Polish', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ru: 'Russian', tr: 'Turkish', hi: 'Hindi', ur: 'Urdu',
  pa: 'Punjabi', phr: 'Pahari', prs: 'Dari'
};

async function handleGrammarCheck(text, language) {
  const langName = LANG_NAMES[language] || language;
  const systemPrompt = `You are a professional ${langName} grammar and spelling checker. Analyze the text and return a JSON response with this exact structure:
{
  "corrected": "the full corrected text",
  "issues": [
    {
      "type": "grammar|spelling|punctuation|style",
      "original": "the wrong part",
      "suggestion": "the corrected part",
      "explanation": "brief explanation in ${langName}"
    }
  ],
  "score": 85
}

Rules:
- "corrected" must contain the full text with all corrections applied
- "issues" lists each problem found (empty array if text is perfect)
- "score" is a writing quality score from 0-100
- Keep explanations short and in ${langName}
- Respond ONLY with valid JSON, no markdown, no backticks`;

  const result = await callClaudeAPI(systemPrompt, text);
  if (result.error) return result;

  try {
    const parsed = JSON.parse(result.result);
    return { result: parsed };
  } catch {
    const jsonMatch = result.result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return { result: JSON.parse(jsonMatch[0]) };
      } catch {}
    }
    return { error: 'Failed to parse AI response' };
  }
}

async function handleRephrase(text, language, style) {
  const langName = LANG_NAMES[language] || language;
  const styleInstructions = {
    rephrase: `Rephrase the text in ${langName} to be clearer and more natural while keeping the same meaning.`,
    formal: `Rewrite the text in ${langName} using formal, professional language suitable for business correspondence.`,
    casual: `Rewrite the text in ${langName} using casual, friendly language suitable for informal communication.`,
    concise: `Make the text shorter and more concise in ${langName} while keeping the key meaning.`,
    elaborate: `Expand and elaborate on the text in ${langName} with more detail and nuance.`
  };

  const systemPrompt = `You are a professional ${langName} writing assistant. ${styleInstructions[style] || styleInstructions.rephrase}

Return a JSON response:
{
  "rephrased": "the rephrased text",
  "changes": "brief description of what changed, in ${langName}"
}

Respond ONLY with valid JSON, no markdown, no backticks.`;

  const result = await callClaudeAPI(systemPrompt, text);
  if (result.error) return result;

  try {
    const parsed = JSON.parse(result.result);
    return { result: parsed };
  } catch {
    const jsonMatch = result.result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return { result: JSON.parse(jsonMatch[0]) };
      } catch {}
    }
    return { error: 'Failed to parse AI response' };
  }
}
