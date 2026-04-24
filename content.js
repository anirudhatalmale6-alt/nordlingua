(() => {
  let settings = { language: 'sv', autoCheck: true, checkDelay: 1500, enabled: true };
  let checkTimers = new Map();
  let activePanel = null;
  let lastResults = new Map();

  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (s) => {
    if (s) settings = { ...settings, ...s };
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) settings = { ...settings, ...changes.settings.newValue };
  });

  function createPanel() {
    if (activePanel) activePanel.remove();
    const panel = document.createElement('div');
    panel.id = 'nordlingua-panel';
    panel.innerHTML = `
      <div class="nl-panel-header">
        <div class="nl-panel-title">
          <span class="nl-logo">N</span> NordLingua
        </div>
        <div class="nl-panel-actions">
          <button class="nl-btn-icon" id="nl-minimize" title="Minimize">&#8722;</button>
          <button class="nl-btn-icon" id="nl-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="nl-panel-body" id="nl-body">
        <div class="nl-loading" id="nl-loading" style="display:none">
          <div class="nl-spinner"></div>
          <span>Analyserar text...</span>
        </div>
        <div id="nl-results"></div>
      </div>
      <div class="nl-panel-footer">
        <div class="nl-score-bar" id="nl-score-section" style="display:none">
          <div class="nl-score-label">Kvalitet</div>
          <div class="nl-score-track"><div class="nl-score-fill" id="nl-score-fill"></div></div>
          <div class="nl-score-value" id="nl-score-value">--</div>
        </div>
        <div class="nl-toolbar">
          <button class="nl-btn nl-btn-primary" id="nl-check-btn" title="Check grammar">Kontrollera</button>
          <button class="nl-btn" id="nl-rephrase-btn" title="Rephrase">Omformulera</button>
          <button class="nl-btn" id="nl-formal-btn" title="Make formal">Formell</button>
          <button class="nl-btn" id="nl-casual-btn" title="Make casual">Avslappnad</button>
          <button class="nl-btn" id="nl-apply-btn" title="Apply corrections" style="display:none">Tilllampa</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    activePanel = panel;

    document.getElementById('nl-close').onclick = () => { panel.remove(); activePanel = null; };
    document.getElementById('nl-minimize').onclick = () => panel.classList.toggle('nl-minimized');
    document.getElementById('nl-check-btn').onclick = () => checkCurrentField();
    document.getElementById('nl-rephrase-btn').onclick = () => rephraseCurrentField('rephrase');
    document.getElementById('nl-formal-btn').onclick = () => rephraseCurrentField('formal');
    document.getElementById('nl-casual-btn').onclick = () => rephraseCurrentField('casual');

    return panel;
  }

  function getActiveText() {
    const el = document.activeElement;
    if (!el) return { text: '', element: null };

    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start !== end) return { text: el.value.substring(start, end), element: el, selected: true, start, end };
      return { text: el.value, element: el, selected: false };
    }

    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      const sel = window.getSelection();
      if (sel && sel.toString().trim()) return { text: sel.toString(), element: el, selected: true };
      return { text: el.innerText, element: el, selected: false };
    }

    const sel = window.getSelection();
    if (sel && sel.toString().trim()) return { text: sel.toString(), element: null, selected: true };

    return { text: '', element: null };
  }

  function setActiveText(newText) {
    const el = document.activeElement;
    if (!el) return;

    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start !== end) {
        el.value = el.value.substring(0, start) + newText + el.value.substring(end);
      } else {
        el.value = newText;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(newText));
      } else {
        el.innerText = newText;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  async function checkCurrentField() {
    const { text, element } = getActiveText();
    if (!text || text.trim().length < 3) {
      showResults({ issues: [], corrected: text, score: 100 });
      return;
    }

    showLoading(true);
    const resp = await chrome.runtime.sendMessage({ type: 'CHECK_GRAMMAR', text, language: settings.language });
    showLoading(false);

    if (resp.error) {
      showError(resp.error);
      return;
    }

    lastResults.set('check', { result: resp.result, element });
    showResults(resp.result);
  }

  async function rephraseCurrentField(style) {
    const { text, element } = getActiveText();
    if (!text || text.trim().length < 3) return;

    showLoading(true);
    const resp = await chrome.runtime.sendMessage({ type: 'REPHRASE', text, language: settings.language, style });
    showLoading(false);

    if (resp.error) {
      showError(resp.error);
      return;
    }

    lastResults.set('rephrase', { result: resp.result, element });
    showRephraseResult(resp.result);
  }

  function showLoading(show) {
    if (!activePanel) createPanel();
    const loading = document.getElementById('nl-loading');
    const results = document.getElementById('nl-results');
    if (loading) loading.style.display = show ? 'flex' : 'none';
    if (results && show) results.innerHTML = '';
  }

  function showError(msg) {
    const results = document.getElementById('nl-results');
    if (!results) return;
    results.innerHTML = `<div class="nl-error"><span class="nl-error-icon">!</span> ${escHtml(msg)}</div>`;
  }

  function showResults(data) {
    const results = document.getElementById('nl-results');
    const scoreSection = document.getElementById('nl-score-section');
    const applyBtn = document.getElementById('nl-apply-btn');
    if (!results) return;

    const issues = data.issues || [];
    const score = data.score || 100;

    if (scoreSection) {
      scoreSection.style.display = 'flex';
      const fill = document.getElementById('nl-score-fill');
      const value = document.getElementById('nl-score-value');
      fill.style.width = score + '%';
      fill.style.background = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
      value.textContent = score;
    }

    if (issues.length === 0) {
      results.innerHTML = `<div class="nl-perfect"><span class="nl-check-icon">&#10003;</span> Texten ser perfekt ut!</div>`;
      if (applyBtn) applyBtn.style.display = 'none';
      return;
    }

    if (applyBtn) applyBtn.style.display = '';
    applyBtn.onclick = () => {
      const last = lastResults.get('check');
      if (last && last.result.corrected) {
        setActiveText(last.result.corrected);
        showResults({ issues: [], corrected: last.result.corrected, score: 100 });
      }
    };

    const typeIcons = { grammar: 'G', spelling: 'S', punctuation: 'P', style: 'T' };
    const typeColors = { grammar: '#ef4444', spelling: '#f59e0b', punctuation: '#8b5cf6', style: '#3b82f6' };
    const typeLabels = { grammar: 'Grammatik', spelling: 'Stavning', punctuation: 'Skiljetecken', style: 'Stil' };

    results.innerHTML = `
      <div class="nl-issue-count">${issues.length} ${issues.length === 1 ? 'problem hittat' : 'problem hittade'}</div>
      ${issues.map((issue, i) => `
        <div class="nl-issue" data-index="${i}">
          <div class="nl-issue-header">
            <span class="nl-issue-type" style="background:${typeColors[issue.type] || '#6b7280'}">${typeIcons[issue.type] || '?'}</span>
            <span class="nl-issue-type-label">${typeLabels[issue.type] || issue.type}</span>
          </div>
          <div class="nl-issue-content">
            <div class="nl-issue-original"><del>${escHtml(issue.original)}</del> &rarr; <strong>${escHtml(issue.suggestion)}</strong></div>
            <div class="nl-issue-explanation">${escHtml(issue.explanation)}</div>
          </div>
        </div>
      `).join('')}
    `;
  }

  function showRephraseResult(data) {
    const results = document.getElementById('nl-results');
    const scoreSection = document.getElementById('nl-score-section');
    const applyBtn = document.getElementById('nl-apply-btn');
    if (!results) return;
    if (scoreSection) scoreSection.style.display = 'none';

    if (applyBtn) {
      applyBtn.style.display = '';
      applyBtn.onclick = () => {
        if (data.rephrased) {
          setActiveText(data.rephrased);
        }
      };
    }

    results.innerHTML = `
      <div class="nl-rephrase-result">
        <div class="nl-rephrase-label">Omformulerat:</div>
        <div class="nl-rephrase-text">${escHtml(data.rephrased)}</div>
        ${data.changes ? `<div class="nl-rephrase-changes">${escHtml(data.changes)}</div>` : ''}
      </div>
    `;
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // Auto-check on text input
  function setupAutoCheck(el) {
    if (!settings.autoCheck || !settings.enabled) return;
    if (el._nlAttached) return;
    el._nlAttached = true;

    el.addEventListener('input', () => {
      if (!settings.autoCheck || !settings.enabled) return;
      const id = el.id || el.name || 'default';
      if (checkTimers.has(id)) clearTimeout(checkTimers.get(id));

      checkTimers.set(id, setTimeout(async () => {
        const text = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText;
        if (!text || text.trim().length < 20) return;

        const resp = await chrome.runtime.sendMessage({ type: 'CHECK_GRAMMAR', text, language: settings.language });
        if (resp.error || !resp.result) return;

        const issues = resp.result.issues || [];
        removeUnderlines(el);
        if (issues.length > 0) {
          addUnderlines(el, issues);
        }
      }, settings.checkDelay));
    });
  }

  function addUnderlines(el, issues) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      if (!el._nlBadge) {
        const badge = document.createElement('div');
        badge.className = 'nl-field-badge';
        badge.title = `${issues.length} ${issues.length === 1 ? 'problem' : 'problem'}`;
        badge.textContent = issues.length;
        badge.onclick = (e) => {
          e.stopPropagation();
          el.focus();
          if (!activePanel) createPanel();
          showResults({ issues, corrected: '', score: 0 });
        };
        el.parentElement.style.position = el.parentElement.style.position || 'relative';
        el.parentElement.appendChild(badge);
        el._nlBadge = badge;
      } else {
        el._nlBadge.textContent = issues.length;
        el._nlBadge.title = `${issues.length} ${issues.length === 1 ? 'problem' : 'problem'}`;
      }
    }
  }

  function removeUnderlines(el) {
    if (el._nlBadge) {
      el._nlBadge.remove();
      el._nlBadge = null;
    }
  }

  // Observe new text fields
  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'TEXTAREA') setupAutoCheck(node);
        if (node.isContentEditable) setupAutoCheck(node);
        const fields = node.querySelectorAll ? node.querySelectorAll('textarea, [contenteditable="true"]') : [];
        fields.forEach(f => setupAutoCheck(f));
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.querySelectorAll('textarea, [contenteditable="true"]').forEach(f => setupAutoCheck(f));

  // Keyboard shortcut: Ctrl+Shift+G to open panel and check
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      if (!activePanel) createPanel();
      checkCurrentField();
    }
  });

  // Context menu actions from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'CONTEXT_ACTION') {
      if (!activePanel) createPanel();
      if (msg.action === 'check') checkCurrentField();
      else rephraseCurrentField(msg.action);
    }
  });

  // Floating activation button
  const fab = document.createElement('div');
  fab.id = 'nordlingua-fab';
  fab.innerHTML = '<span class="nl-fab-letter">N</span>';
  fab.title = 'NordLingua - Click or Ctrl+Shift+G';
  fab.onclick = () => {
    if (activePanel) {
      activePanel.remove();
      activePanel = null;
    } else {
      createPanel();
      checkCurrentField();
    }
  };
  document.body.appendChild(fab);
})();
