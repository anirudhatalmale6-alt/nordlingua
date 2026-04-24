document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get('settings', (data) => {
    const s = data.settings || {};
    document.getElementById('apiKey').value = s.apiKey || '';
    document.getElementById('autoCheck').value = String(s.autoCheck !== false);
    document.getElementById('checkDelay').value = s.checkDelay || 1500;
    document.getElementById('enableToggle').checked = s.enabled !== false;

    const lang = s.language || 'sv';
    document.querySelectorAll('.lang-option').forEach(el => {
      el.classList.toggle('active', el.dataset.lang === lang);
    });
  });

  document.querySelectorAll('.lang-option').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.lang-option').forEach(o => o.classList.remove('active'));
      el.classList.add('active');
    });
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const activeLang = document.querySelector('.lang-option.active');
    const settings = {
      apiKey: document.getElementById('apiKey').value.trim(),
      language: activeLang ? activeLang.dataset.lang : 'sv',
      autoCheck: document.getElementById('autoCheck').value === 'true',
      checkDelay: parseInt(document.getElementById('checkDelay').value) || 1500,
      enabled: document.getElementById('enableToggle').checked
    };

    chrome.storage.sync.set({ settings }, () => {
      const msg = document.getElementById('successMsg');
      msg.style.display = 'block';
      setTimeout(() => { msg.style.display = 'none'; }, 2000);
    });
  });

  document.getElementById('enableToggle').addEventListener('change', (e) => {
    chrome.storage.sync.get('settings', (data) => {
      const s = data.settings || {};
      s.enabled = e.target.checked;
      chrome.storage.sync.set({ settings: s });
    });
  });
});
