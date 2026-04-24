(() => {
  let settings = { language: 'sv', autoCheck: true, checkDelay: 1500, enabled: true, goals: {} };
  let checkTimers = new Map();
  let activePanel = null;
  let lastResults = new Map();
  let activeHoverCard = null;
  let fieldIssues = new Map();

  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (s) => {
    if (s) settings = { ...settings, ...s };
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) settings = { ...settings, ...changes.settings.newValue };
  });

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ─── Inline Underlines for ContentEditable ───
  function highlightIssuesInEditable(el, issues) {
    clearHighlights(el);
    if (!issues.length) return;
    fieldIssues.set(el, issues);

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    let fullText = textNodes.map(n => n.textContent).join('');

    for (let i = issues.length - 1; i >= 0; i--) {
      const issue = issues[i];
      const orig = issue.original;
      const idx = fullText.indexOf(orig);
      if (idx === -1) continue;

      let charCount = 0;
      for (const tNode of textNodes) {
        const nodeLen = tNode.textContent.length;
        const nodeStart = charCount;
        const nodeEnd = charCount + nodeLen;

        if (idx >= nodeStart && idx < nodeEnd) {
          const localStart = idx - nodeStart;
          const localEnd = Math.min(localStart + orig.length, nodeLen);
          const matchLen = localEnd - localStart;

          const before = tNode.textContent.substring(0, localStart);
          const match = tNode.textContent.substring(localStart, localEnd);
          const after = tNode.textContent.substring(localEnd);

          const span = document.createElement('span');
          span.className = 'ord-underline';
          span.dataset.issueIndex = i;
          span.dataset.type = issue.type || 'grammar';
          span.textContent = match;

          const typeColors = { grammar: '#ef4444', spelling: '#f59e0b', punctuation: '#8b5cf6', style: '#3b82f6' };
          span.style.backgroundImage = `linear-gradient(to right, ${typeColors[issue.type] || '#ef4444'} 0%, ${typeColors[issue.type] || '#ef4444'} 100%)`;
          span.style.backgroundPosition = 'bottom';
          span.style.backgroundSize = '100% 2px';
          span.style.backgroundRepeat = 'no-repeat';
          span.style.cursor = 'pointer';
          span.style.position = 'relative';

          span.addEventListener('mouseenter', (e) => showHoverCard(e, issue, span, el));
          span.addEventListener('mouseleave', () => {
            setTimeout(() => {
              if (activeHoverCard && !activeHoverCard.matches(':hover')) {
                removeHoverCard();
              }
            }, 200);
          });

          const parent = tNode.parentNode;
          if (before) parent.insertBefore(document.createTextNode(before), tNode);
          parent.insertBefore(span, tNode);
          if (after) parent.insertBefore(document.createTextNode(after), tNode);
          parent.removeChild(tNode);
          break;
        }
        charCount += nodeLen;
      }
    }
  }

  function clearHighlights(el) {
    if (!el) return;
    const spans = el.querySelectorAll('.ord-underline');
    spans.forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });
    el.normalize();
  }

  // ─── Hover Card (Grammarly-style popup on underlined text) ───
  function showHoverCard(e, issue, span, field) {
    removeHoverCard();
    const card = document.createElement('div');
    card.className = 'ord-hover-card';

    const typeLabels = { grammar: 'Grammar', spelling: 'Spelling', punctuation: 'Punctuation', style: 'Style' };
    const typeColors = { grammar: '#ef4444', spelling: '#f59e0b', punctuation: '#8b5cf6', style: '#3b82f6' };

    card.innerHTML = `
      <div class="ord-hc-header">
        <span class="ord-hc-badge" style="background:${typeColors[issue.type] || '#6b7280'}">${typeLabels[issue.type] || issue.type}</span>
        <button class="ord-hc-dismiss" title="Dismiss">&times;</button>
      </div>
      <div class="ord-hc-body">
        <div class="ord-hc-change"><del>${escHtml(issue.original)}</del> &rarr; <strong>${escHtml(issue.suggestion)}</strong></div>
        <div class="ord-hc-explanation">${escHtml(issue.explanation)}</div>
      </div>
      <div class="ord-hc-actions">
        <button class="ord-hc-accept">Accept</button>
        <button class="ord-hc-ignore">Ignore</button>
      </div>
    `;

    document.body.appendChild(card);
    activeHoverCard = card;

    const rect = span.getBoundingClientRect();
    card.style.position = 'fixed';
    card.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
    card.style.top = (rect.bottom + 6) + 'px';
    card.style.zIndex = '2147483647';

    if (rect.bottom + card.offsetHeight + 6 > window.innerHeight) {
      card.style.top = (rect.top - card.offsetHeight - 6) + 'px';
    }

    card.querySelector('.ord-hc-accept').onclick = () => {
      applyInlineFix(span, issue, field);
      removeHoverCard();
    };

    card.querySelector('.ord-hc-ignore').onclick = () => {
      span.style.backgroundImage = 'none';
      span.classList.remove('ord-underline');
      removeHoverCard();
    };

    card.querySelector('.ord-hc-dismiss').onclick = () => removeHoverCard();

    card.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (activeHoverCard && !span.matches(':hover')) removeHoverCard();
      }, 200);
    });
  }

  function removeHoverCard() {
    if (activeHoverCard) {
      activeHoverCard.remove();
      activeHoverCard = null;
    }
  }

  function applyInlineFix(span, issue, field) {
    const replacement = document.createTextNode(issue.suggestion);
    span.parentNode.replaceChild(replacement, span);
    if (field) {
      field.normalize();
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    updateBadgeCount(field);
  }

  function updateBadgeCount(el) {
    if (!el) return;
    const remaining = el.querySelectorAll('.ord-underline').length;
    if (el._ordBadge) {
      if (remaining === 0) {
        el._ordBadge.remove();
        el._ordBadge = null;
      } else {
        el._ordBadge.textContent = remaining;
      }
    }
  }

  // ─── Badge for textarea/input (can't do inline underlines) ───
  function addBadge(el, issues, corrected) {
    if (el._ordBadge) el._ordBadge.remove();
    if (!issues.length) return;

    fieldIssues.set(el, { issues, corrected });

    const badge = document.createElement('div');
    badge.className = 'ord-field-badge';
    badge.textContent = issues.length;
    badge.title = `${issues.length} issue${issues.length === 1 ? '' : 's'} found`;
    badge.onclick = (e) => {
      e.stopPropagation();
      el.focus();
      if (!activePanel) createPanel();
      showResults({ issues, corrected, score: Math.max(0, 100 - issues.length * 10) });
    };

    el.parentElement.style.position = el.parentElement.style.position || 'relative';
    el.parentElement.appendChild(badge);
    el._ordBadge = badge;
  }

  function removeBadge(el) {
    if (el._ordBadge) {
      el._ordBadge.remove();
      el._ordBadge = null;
    }
  }

  // ─── Panel ───
  function createPanel() {
    if (activePanel) activePanel.remove();
    const panel = document.createElement('div');
    panel.id = 'ord-panel';
    panel.innerHTML = `
      <div class="ord-panel-header">
        <div class="ord-panel-title">
          <span class="ord-logo">O</span> Ord
        </div>
        <div class="ord-panel-actions">
          <button class="ord-btn-icon" id="ord-minimize" title="Minimize">&#8722;</button>
          <button class="ord-btn-icon" id="ord-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="ord-panel-body" id="ord-body">
        <div class="ord-loading" id="ord-loading" style="display:none">
          <div class="ord-spinner"></div>
          <span>Analyzing...</span>
        </div>
        <div id="ord-results"></div>
        <div id="ord-tone" style="display:none"></div>
      </div>
      <div class="ord-panel-footer">
        <div class="ord-score-bar" id="ord-score-section" style="display:none">
          <div class="ord-score-label">Quality</div>
          <div class="ord-score-track"><div class="ord-score-fill" id="ord-score-fill"></div></div>
          <div class="ord-score-value" id="ord-score-value">--</div>
        </div>
        <div class="ord-toolbar">
          <button class="ord-btn ord-btn-primary" id="ord-check-btn">Check</button>
          <button class="ord-btn" id="ord-rephrase-btn">Rephrase</button>
          <button class="ord-btn" id="ord-formal-btn">Formal</button>
          <button class="ord-btn" id="ord-casual-btn">Casual</button>
          <button class="ord-btn ord-btn-success" id="ord-apply-btn" style="display:none">Apply All</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    activePanel = panel;

    document.getElementById('ord-close').onclick = () => { panel.remove(); activePanel = null; };
    document.getElementById('ord-minimize').onclick = () => panel.classList.toggle('ord-minimized');
    document.getElementById('ord-check-btn').onclick = () => checkCurrentField();
    document.getElementById('ord-rephrase-btn').onclick = () => rephraseCurrentField('rephrase');
    document.getElementById('ord-formal-btn').onclick = () => rephraseCurrentField('formal');
    document.getElementById('ord-casual-btn').onclick = () => rephraseCurrentField('casual');

    makeDraggable(panel);
    return panel;
  }

  function makeDraggable(panel) {
    const header = panel.querySelector('.ord-panel-header');
    let isDragging = false, startX, startY, origX, origY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      header.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = (origX + e.clientX - startX) + 'px';
      panel.style.top = (origY + e.clientY - startY) + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      header.style.cursor = 'default';
    });
  }

  // ─── Text helpers ───
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
      clearHighlights(el);
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

  // ─── Check & Rephrase ───
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

    if (element && (element.isContentEditable || element.getAttribute('contenteditable') === 'true')) {
      highlightIssuesInEditable(element, resp.result.issues || []);
    } else if (element && (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT')) {
      addBadge(element, resp.result.issues || [], resp.result.corrected);
    }

    detectTone(text);
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

  // ─── Tone Detector ───
  function detectTone(text) {
    const toneEl = document.getElementById('ord-tone');
    if (!toneEl) return;

    const words = text.toLowerCase().split(/\s+/);
    const wordCount = words.length;
    const avgWordLen = words.reduce((a, w) => a + w.length, 0) / (wordCount || 1);
    const sentenceCount = (text.match(/[.!?]+/g) || []).length || 1;
    const avgSentLen = wordCount / sentenceCount;
    const exclamations = (text.match(/!/g) || []).length;
    const questions = (text.match(/\?/g) || []).length;

    const formalWords = ['regarding', 'furthermore', 'consequently', 'therefore', 'hereby', 'whereas', 'nevertheless', 'henceforth', 'pursuant', 'accordingly', 'med anledning', 'avseende', 'härmed', 'vidare'];
    const casualWords = ['hey', 'cool', 'awesome', 'gonna', 'wanna', 'lol', 'haha', 'yeah', 'nope', 'btw', 'hej', 'kul', 'fett', 'asså', 'typ'];
    const confidentWords = ['will', 'must', 'clearly', 'certainly', 'definitely', 'absolutely', 'without doubt', 'ska', 'måste', 'definitivt', 'självklart'];
    const friendlyWords = ['please', 'thank', 'appreciate', 'glad', 'happy', 'hope', 'wonderful', 'great', 'tack', 'glad', 'hoppas', 'underbart', 'fantastiskt'];

    let formalScore = 0, casualScore = 0, confidentScore = 0, friendlyScore = 0;
    const textLower = text.toLowerCase();

    formalWords.forEach(w => { if (textLower.includes(w)) formalScore += 2; });
    casualWords.forEach(w => { if (textLower.includes(w)) casualScore += 2; });
    confidentWords.forEach(w => { if (textLower.includes(w)) confidentScore += 2; });
    friendlyWords.forEach(w => { if (textLower.includes(w)) friendlyScore += 2; });

    if (avgWordLen > 6) formalScore += 2;
    if (avgSentLen > 20) formalScore += 1;
    if (avgWordLen < 5) casualScore += 1;
    if (exclamations > 1) casualScore += 1;
    if (exclamations > 0) friendlyScore += 1;
    if (questions > 0) friendlyScore += 1;

    const tones = [
      { name: 'Formal', score: formalScore, color: '#6366f1', icon: '🎩' },
      { name: 'Casual', score: casualScore, color: '#f59e0b', icon: '😊' },
      { name: 'Confident', score: confidentScore, color: '#22c55e', icon: '💪' },
      { name: 'Friendly', score: friendlyScore, color: '#3b82f6', icon: '👋' }
    ];

    const maxScore = Math.max(...tones.map(t => t.score));
    const dominant = tones.find(t => t.score === maxScore) || tones[0];

    if (maxScore === 0) {
      dominant.name = 'Neutral';
      dominant.color = '#64748b';
      dominant.icon = '📝';
    }

    const total = tones.reduce((a, t) => a + t.score, 0) || 1;

    toneEl.style.display = 'block';
    toneEl.innerHTML = `
      <div class="ord-tone-section">
        <div class="ord-tone-title">Tone: <span style="color:${dominant.color};font-weight:600">${dominant.icon} ${dominant.name}</span></div>
        <div class="ord-tone-bars">
          ${tones.map(t => `
            <div class="ord-tone-row">
              <span class="ord-tone-label">${t.icon} ${t.name}</span>
              <div class="ord-tone-track"><div class="ord-tone-fill" style="width:${Math.round(t.score / total * 100)}%;background:${t.color}"></div></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ─── UI Updates ───
  function showLoading(show) {
    if (!activePanel) createPanel();
    const loading = document.getElementById('ord-loading');
    const results = document.getElementById('ord-results');
    if (loading) loading.style.display = show ? 'flex' : 'none';
    if (results && show) results.innerHTML = '';
    const toneEl = document.getElementById('ord-tone');
    if (toneEl && show) toneEl.style.display = 'none';
  }

  function showError(msg) {
    const results = document.getElementById('ord-results');
    if (!results) return;
    results.innerHTML = `<div class="ord-error"><span class="ord-error-icon">!</span> ${escHtml(msg)}</div>`;
  }

  function showResults(data) {
    const results = document.getElementById('ord-results');
    const scoreSection = document.getElementById('ord-score-section');
    const applyBtn = document.getElementById('ord-apply-btn');
    if (!results) return;

    const issues = data.issues || [];
    const score = data.score || 100;

    if (scoreSection) {
      scoreSection.style.display = 'flex';
      const fill = document.getElementById('ord-score-fill');
      const value = document.getElementById('ord-score-value');
      fill.style.width = score + '%';
      fill.style.background = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
      value.textContent = score;
    }

    if (issues.length === 0) {
      results.innerHTML = `<div class="ord-perfect"><span style="font-size:18px;color:#22c55e">&#10003;</span> Text looks perfect!</div>`;
      if (applyBtn) applyBtn.style.display = 'none';
      return;
    }

    if (applyBtn) applyBtn.style.display = '';
    applyBtn.onclick = () => {
      const last = lastResults.get('check');
      if (last && last.result.corrected) {
        if (last.element) clearHighlights(last.element);
        setActiveText(last.result.corrected);
        removeBadge(last.element);
        showResults({ issues: [], corrected: last.result.corrected, score: 100 });
      }
    };

    const typeIcons = { grammar: 'G', spelling: 'S', punctuation: 'P', style: 'T' };
    const typeColors = { grammar: '#ef4444', spelling: '#f59e0b', punctuation: '#8b5cf6', style: '#3b82f6' };
    const typeLabels = { grammar: 'Grammar', spelling: 'Spelling', punctuation: 'Punctuation', style: 'Style' };

    results.innerHTML = `
      <div class="ord-issue-count">${issues.length} issue${issues.length === 1 ? '' : 's'} found</div>
      ${issues.map((issue, i) => `
        <div class="ord-issue" data-index="${i}">
          <div class="ord-issue-header">
            <span class="ord-issue-type" style="background:${typeColors[issue.type] || '#6b7280'}">${typeIcons[issue.type] || '?'}</span>
            <span class="ord-issue-type-label">${typeLabels[issue.type] || issue.type}</span>
          </div>
          <div class="ord-issue-content">
            <div class="ord-issue-original"><del>${escHtml(issue.original)}</del> &rarr; <strong>${escHtml(issue.suggestion)}</strong></div>
            <div class="ord-issue-explanation">${escHtml(issue.explanation)}</div>
          </div>
        </div>
      `).join('')}
    `;
  }

  function showRephraseResult(data) {
    const results = document.getElementById('ord-results');
    const scoreSection = document.getElementById('ord-score-section');
    const applyBtn = document.getElementById('ord-apply-btn');
    if (!results) return;
    if (scoreSection) scoreSection.style.display = 'none';
    const toneEl = document.getElementById('ord-tone');
    if (toneEl) toneEl.style.display = 'none';

    if (applyBtn) {
      applyBtn.style.display = '';
      applyBtn.onclick = () => {
        if (data.rephrased) setActiveText(data.rephrased);
      };
    }

    results.innerHTML = `
      <div class="ord-rephrase-result">
        <div class="ord-rephrase-label">Rephrased:</div>
        <div class="ord-rephrase-text">${escHtml(data.rephrased)}</div>
        ${data.changes ? `<div class="ord-rephrase-changes">${escHtml(data.changes)}</div>` : ''}
      </div>
    `;
  }

  // ─── Auto-check on typing ───
  function setupAutoCheck(el) {
    if (!settings.autoCheck || !settings.enabled) return;
    if (el._ordAttached) return;
    el._ordAttached = true;

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

        if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
          highlightIssuesInEditable(el, issues);
        } else {
          removeBadge(el);
          if (issues.length > 0) addBadge(el, issues, resp.result.corrected);
        }
      }, settings.checkDelay));
    });
  }

  // ─── Observe new text fields ───
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

  // ─── Keyboard shortcut ───
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      if (!activePanel) createPanel();
      checkCurrentField();
    }
  });

  // ─── Context menu actions ───
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'CONTEXT_ACTION') {
      if (!activePanel) createPanel();
      if (msg.action === 'check') checkCurrentField();
      else rephraseCurrentField(msg.action);
    }
  });

  // ─── Close hover card on scroll/click outside ───
  document.addEventListener('scroll', () => removeHoverCard(), true);
  document.addEventListener('click', (e) => {
    if (activeHoverCard && !activeHoverCard.contains(e.target) && !e.target.classList.contains('ord-underline')) {
      removeHoverCard();
    }
  });

  // ─── FAB Button ───
  const fab = document.createElement('div');
  fab.id = 'ord-fab';
  fab.innerHTML = '<span class="ord-fab-letter">O</span>';
  fab.title = 'Ord - AI Writing Assistant (Ctrl+Shift+G)';
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
