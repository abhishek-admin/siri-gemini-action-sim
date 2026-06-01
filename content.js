(() => {
  if (window.__sgasContentLoaded) return;
  window.__sgasContentLoaded = true;

  const ID_ATTR = 'data-sgas-id';
  const HIGHLIGHT_CLASS = 'sgas-highlight';
  const FILL_CLASS = 'sgas-fill-target';
  const PANEL_ID = 'sgas-preview-panel';
  let idCounter = 1;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'sgasCollectContext') {
      sendResponse(collectContext());
      return true;
    }

    if (message.action === 'sgasPreviewPlan') {
      previewPlan(message.plan || {});
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === 'sgasApplyActions') {
      const result = applySafeActions(message.actions || []);
      sendResponse(result);
      return true;
    }

    if (message.action === 'sgasClearPreview') {
      clearPreview();
      sendResponse({ ok: true });
      return true;
    }
  });

  function collectContext() {
    assignElementIds();
    const selectedText = String(window.getSelection?.() || '').trim();
    const main = document.querySelector('main, article') || document.body;
    const clone = main.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, svg, canvas, iframe, nav, footer, header, aside, [aria-hidden="true"], .ad, .ads, [role="navigation"]')
      .forEach((node) => node.remove());

    const text = normalizeText(clone.innerText || document.body.innerText || '').slice(0, 14000);
    const elements = collectActionableElements();

    return {
      title: document.title || '',
      url: location.href,
      selectedText,
      metaDescription: document.querySelector('meta[name="description"]')?.content || '',
      text,
      elements,
      capabilities: {
        allowed: ['highlight', 'fill', 'copy'],
        blocked: ['click', 'submit', 'purchase', 'delete', 'navigate', 'download', 'send_message_without_review']
      }
    };
  }

  function assignElementIds() {
    const candidates = document.querySelectorAll([
      'input',
      'textarea',
      '[contenteditable="true"]',
      'button',
      'a',
      'select',
      '[role="button"]',
      'h1',
      'h2',
      'h3',
      'p',
      'li',
      'label'
    ].join(','));

    for (const el of candidates) {
      if (!el.getAttribute(ID_ATTR)) {
        el.setAttribute(ID_ATTR, `sgas-${idCounter++}`);
      }
    }
  }

  function collectActionableElements() {
    const raw = Array.from(document.querySelectorAll(`[${ID_ATTR}]`))
      .filter(isVisible)
      .slice(0, 180)
      .map((el) => {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const role = el.getAttribute('role') || '';
        const isFillable = tag === 'textarea' || tag === 'select' || el.isContentEditable ||
          (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(type));

        return {
          id: el.getAttribute(ID_ATTR),
          tag,
          type,
          role,
          fillable: isFillable,
          label: findLabel(el),
          placeholder: el.getAttribute('placeholder') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          text: normalizeText(el.innerText || el.value || el.getAttribute('title') || '').slice(0, 180)
        };
      });

    return raw.filter((item) =>
      item.fillable ||
      item.text ||
      item.label ||
      item.placeholder ||
      item.ariaLabel
    );
  }

  function findLabel(el) {
    const id = el.id;
    const direct = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const wrapping = el.closest('label');
    const aria = el.getAttribute('aria-labelledby');
    const ariaText = aria ? Array.from(document.querySelectorAll(aria.split(/\s+/).map((x) => `#${CSS.escape(x)}`).join(','))).map((node) => node.innerText).join(' ') : '';
    return normalizeText(direct?.innerText || wrapping?.innerText || ariaText || '');
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || el.closest(`#${PANEL_ID}`)) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function previewPlan(plan) {
    clearPreview();
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="sgas-panel-head">
        <div>
          <div class="sgas-panel-title">Siri-Gemini preview</div>
          <div class="sgas-panel-subtitle">Nothing has been applied. Review in the popup.</div>
        </div>
        <button class="sgas-panel-close" type="button" aria-label="Close preview">x</button>
      </div>
      <div class="sgas-panel-body">
        <div class="sgas-action-list">
          ${actions.length ? actions.map(renderAction).join('') : '<div class="sgas-action-item"><div class="sgas-action-desc">No page actions requested.</div></div>'}
        </div>
      </div>
    `;
    document.documentElement.appendChild(panel);
    panel.querySelector('.sgas-panel-close')?.addEventListener('click', clearPreview);

    for (const action of actions) {
      const target = getTarget(action.targetId);
      if (!target) continue;
      target.classList.add(action.type === 'fill' ? FILL_CLASS : HIGHLIGHT_CLASS);
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
  }

  function renderAction(action) {
    const type = escapeHtml(action.type || 'note');
    const target = action.targetId ? `Target: ${escapeHtml(action.targetId)}` : 'Popup-only';
    const desc = escapeHtml(action.description || action.text || action.value || 'Prepared action');
    return `
      <div class="sgas-action-item">
        <div class="sgas-action-type">${type} · ${target}</div>
        <div class="sgas-action-desc">${desc}</div>
      </div>
    `;
  }

  function applySafeActions(actions) {
    const applied = [];
    const skipped = [];

    for (const action of actions) {
      if (action.type === 'fill') {
        const target = getTarget(action.targetId);
        if (!target) {
          skipped.push({ action, reason: 'Target not found' });
          continue;
        }
        if (!isFillable(target)) {
          skipped.push({ action, reason: 'Target is not fillable' });
          continue;
        }
        setValue(target, action.value || action.text || '');
        target.classList.add(FILL_CLASS);
        applied.push({ type: 'fill', targetId: action.targetId });
        continue;
      }

      if (action.type === 'highlight') {
        const target = getTarget(action.targetId);
        if (!target) {
          skipped.push({ action, reason: 'Target not found' });
          continue;
        }
        target.classList.add(HIGHLIGHT_CLASS);
        applied.push({ type: 'highlight', targetId: action.targetId });
        continue;
      }

      if (action.type === 'copy') {
        skipped.push({ action, reason: 'Copy is handled by the popup confirmation button' });
        continue;
      }

      skipped.push({ action, reason: 'Blocked action type. This extension never auto-clicks or submits.' });
    }

    return { applied, skipped };
  }

  function getTarget(id) {
    if (!id) return null;
    return document.querySelector(`[${ID_ATTR}="${CSS.escape(id)}"]`);
  }

  function isFillable(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    return tag === 'textarea' || tag === 'select' || el.isContentEditable ||
      (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(type));
  }

  function setValue(el, value) {
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      return;
    }
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clearPreview() {
    document.getElementById(PANEL_ID)?.remove();
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}, .${FILL_CLASS}`).forEach((el) => {
      el.classList.remove(HIGHLIGHT_CLASS, FILL_CLASS);
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
