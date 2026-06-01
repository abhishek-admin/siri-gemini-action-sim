document.addEventListener('DOMContentLoaded', () => {
  const commandInput = document.getElementById('command-input');
  const runBtn = document.getElementById('run-btn');
  const statusCard = document.getElementById('status-card');
  const planCard = document.getElementById('plan-card');
  const planTitle = document.getElementById('plan-title');
  const riskPill = document.getElementById('risk-pill');
  const answerBox = document.getElementById('answer-box');
  const actionsList = document.getElementById('actions-list');
  const previewBtn = document.getElementById('preview-btn');
  const applyBtn = document.getElementById('apply-btn');
  const copyBtn = document.getElementById('copy-btn');

  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsClose = document.getElementById('settings-close');
  const geminiKeyInput = document.getElementById('gemini-key-input');
  const openrouterKeyInput = document.getElementById('openrouter-key-input');
  const toggleGeminiKey = document.getElementById('toggle-gemini-key');
  const toggleOpenrouterKey = document.getElementById('toggle-openrouter-key');
  const saveKeysBtn = document.getElementById('save-keys-btn');
  const clearKeysBtn = document.getElementById('clear-keys-btn');

  let currentPlan = null;
  let currentContext = null;

  chrome.storage.local.get(['gemini_api_key', 'openrouter_api_key', 'sgas_last_command'], (data) => {
    geminiKeyInput.value = data.gemini_api_key || '';
    openrouterKeyInput.value = data.openrouter_api_key || '';
    if (data.sgas_last_command) commandInput.value = data.sgas_last_command;
    if (!data.gemini_api_key && !data.openrouter_api_key) {
      settingsPanel.classList.remove('hidden');
      showStatus('Add a Gemini key or OpenRouter key, then run a plan. The extension will never act before preview.', 'ok');
    }
  });

  document.querySelectorAll('.preset-btn').forEach((button) => {
    button.addEventListener('click', () => {
      commandInput.value = button.dataset.command || '';
      commandInput.focus();
    });
  });

  runBtn.addEventListener('click', buildPlan);
  previewBtn.addEventListener('click', previewPlan);
  applyBtn.addEventListener('click', applySafeActions);
  copyBtn.addEventListener('click', copyDraft);

  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });
  settingsClose.addEventListener('click', () => settingsPanel.classList.add('hidden'));
  toggleGeminiKey.addEventListener('click', () => togglePassword(geminiKeyInput, toggleGeminiKey));
  toggleOpenrouterKey.addEventListener('click', () => togglePassword(openrouterKeyInput, toggleOpenrouterKey));
  saveKeysBtn.addEventListener('click', saveKeys);
  clearKeysBtn.addEventListener('click', clearKeys);

  async function buildPlan() {
    const command = commandInput.value.trim();
    if (!command) {
      showStatus('Tell the simulator what you want Siri + Gemini to do on this page.', 'error');
      return;
    }

    setBusy(true, 'Reading the current page and collecting safe element IDs...');
    planCard.classList.add('hidden');
    currentPlan = null;

    try {
      chrome.storage.local.set({ sgas_last_command: command });
      const contextResponse = await sendRuntime({ action: 'getActiveTabContext' });
      if (!contextResponse.success) throw new Error(contextResponse.error);
      currentContext = contextResponse.data;

      setBusy(true, `Read ${currentContext.elements?.length || 0} page elements. Asking Gemini for a constrained action plan...`);
      const prompt = buildPlannerPrompt(command, currentContext);
      const aiResponse = await sendRuntime({
        action: 'callGeminiBackground',
        prompt,
        options: {
          temperature: 0.25,
          maxTokens: 2400,
          responseType: 'json'
        }
      });

      if (!aiResponse.success) throw new Error(aiResponse.error);
      currentPlan = sanitizePlan(parsePlan(aiResponse.data), currentContext);
      renderPlan(currentPlan);
      await previewPlan();
      showStatus('Plan generated and previewed on the page. Review before applying anything.', 'ok');
    } catch (error) {
      showStatus(error.message || 'Could not build a safe action plan.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function buildPlannerPrompt(command, context) {
    const compactElements = (context.elements || []).slice(0, 140).map((el) => ({
      id: el.id,
      tag: el.tag,
      type: el.type,
      fillable: el.fillable,
      label: el.label,
      placeholder: el.placeholder,
      ariaLabel: el.ariaLabel,
      text: el.text
    }));

    return `You are simulating what a future Siri + Gemini browser action layer might do.

This is a concept prototype for WWDC26 commentary. It is not official Apple/Siri.

User command:
${command}

Current page:
Title: ${context.title}
URL: ${context.url}
Meta: ${context.metaDescription || ''}
Selected text: ${context.selectedText || '(none)'}

Visible page text:
${context.text}

Allowed page element IDs:
${JSON.stringify(compactElements, null, 2)}

HARD SAFETY RULES:
- Return STRICT JSON only. No markdown fences.
- Allowed action types: "highlight", "fill", "copy".
- Never create click, submit, purchase, delete, send, navigate, or download actions.
- Use only targetId values from the allowed page element list.
- Use "fill" only when the target element has fillable: true.
- If the user asks to submit/send/click/buy/delete, convert it into a draft/fill/copy action and tell them manual approval is required.
- If selectors are uncertain, prefer "copy" and "highlight" instead of "fill".
- Keep fill values under 1200 characters.
- Include a WWDC/Siri/Gemini angle when relevant.

JSON schema:
{
  "title": "short plan title",
  "risk": "safe" | "needs_review" | "blocked",
  "summary": "short answer for the popup",
  "draft": "copyable draft/reply/summary text",
  "actions": [
    {
      "type": "highlight" | "fill" | "copy",
      "targetId": "sgas-id or null",
      "value": "text for fill or copy",
      "description": "what this action does and why it is safe"
    }
  ],
  "blockedReasons": ["only if any requested unsafe action was blocked"]
}`;
  }

  function parsePlan(raw) {
    const cleaned = String(raw || '')
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch (firstError) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw firstError;
    }
  }

  function sanitizePlan(plan, context) {
    const validIds = new Map((context.elements || []).map((el) => [el.id, el]));
    const safeTypes = new Set(['highlight', 'fill', 'copy']);
    const blockedReasons = Array.isArray(plan.blockedReasons) ? plan.blockedReasons.slice(0, 5) : [];
    const actions = [];

    for (const action of Array.isArray(plan.actions) ? plan.actions : []) {
      const type = String(action.type || '').toLowerCase();
      if (!safeTypes.has(type)) {
        blockedReasons.push(`Blocked unsupported action type: ${type || 'unknown'}`);
        continue;
      }

      const targetId = action.targetId || null;
      const element = targetId ? validIds.get(targetId) : null;

      if ((type === 'highlight' || type === 'fill') && !element) {
        blockedReasons.push(`Skipped ${type}: target ${targetId || '(none)'} is not in the collected page map.`);
        continue;
      }

      if (type === 'fill' && !element.fillable) {
        blockedReasons.push(`Skipped fill: ${targetId} is not a fillable field.`);
        continue;
      }

      actions.push({
        type,
        targetId,
        value: String(action.value || action.text || '').slice(0, 1200),
        description: String(action.description || 'Prepared safe action.').slice(0, 280)
      });
    }

    const draft = String(plan.draft || plan.summary || '').slice(0, 1800);
    if (draft && !actions.some((action) => action.type === 'copy')) {
      actions.unshift({
        type: 'copy',
        targetId: null,
        value: draft,
        description: 'Copyable output stays in the popup until you choose to use it.'
      });
    }

    return {
      title: String(plan.title || 'Safe action plan').slice(0, 80),
      risk: blockedReasons.length ? 'needs_review' : (plan.risk || 'safe'),
      summary: String(plan.summary || 'Gemini prepared a safe preview-first plan.').slice(0, 1400),
      draft,
      actions,
      blockedReasons
    };
  }

  function renderPlan(plan) {
    planTitle.textContent = plan.title;
    riskPill.textContent = plan.risk === 'blocked' ? 'Blocked' : plan.risk === 'needs_review' ? 'Review' : 'Safe';
    riskPill.className = `risk-pill ${plan.risk === 'blocked' ? 'block' : plan.risk === 'needs_review' ? 'warn' : ''}`;
    answerBox.textContent = [plan.summary, plan.blockedReasons?.length ? `\nSafety notes:\n- ${plan.blockedReasons.join('\n- ')}` : ''].join('');

    actionsList.innerHTML = plan.actions.length
      ? plan.actions.map((action) => `
        <div class="action-item">
          <div class="action-meta">${escapeHtml(action.type)} ${action.targetId ? '-> ' + escapeHtml(action.targetId) : '-> popup'}</div>
          <div class="action-desc">${escapeHtml(action.description || action.value || 'Prepared action')}</div>
        </div>
      `).join('')
      : '<div class="action-item"><div class="action-desc">No page actions are needed. Use the copy button for the draft.</div></div>';

    applyBtn.disabled = plan.risk === 'blocked' || !plan.actions.some((action) => action.type === 'fill' || action.type === 'highlight');
    copyBtn.disabled = !(plan.draft || plan.summary);
    planCard.classList.remove('hidden');
  }

  async function previewPlan() {
    if (!currentPlan) return;
    const response = await sendRuntime({
      action: 'sendToActiveTab',
      payload: { action: 'sgasPreviewPlan', plan: currentPlan }
    });
    if (!response.success) throw new Error(response.error);
  }

  async function applySafeActions() {
    if (!currentPlan) return;
    applyBtn.disabled = true;
    try {
      const response = await sendRuntime({
        action: 'sendToActiveTab',
        payload: {
          action: 'sgasApplyActions',
          actions: currentPlan.actions.filter((action) => action.type === 'fill' || action.type === 'highlight')
        }
      });
      if (!response.success) throw new Error(response.error);
      const applied = response.data?.applied?.length || 0;
      const skipped = response.data?.skipped?.length || 0;
      showStatus(`Applied ${applied} safe page action${applied === 1 ? '' : 's'}. Skipped ${skipped}. No clicks or submits were performed.`, 'ok');
    } catch (error) {
      showStatus(error.message || 'Could not apply safe actions.', 'error');
    } finally {
      applyBtn.disabled = false;
    }
  }

  async function copyDraft() {
    const text = currentPlan?.draft || currentPlan?.summary || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy Draft / Summary'; }, 1400);
    } catch (error) {
      showStatus('Clipboard permission failed. Select the draft text and copy manually.', 'error');
    }
  }

  function sendRuntime(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: 'No response from extension runtime.' });
      });
    });
  }

  function setBusy(isBusy, message = '') {
    runBtn.disabled = isBusy;
    runBtn.textContent = isBusy ? 'Building Plan...' : 'Build Safe Action Plan';
    if (message) showStatus(message, 'ok');
  }

  function showStatus(message, type = '') {
    statusCard.textContent = message;
    statusCard.className = `status-card ${type || ''}`;
    statusCard.classList.remove('hidden');
  }

  function togglePassword(input, button) {
    input.type = input.type === 'password' ? 'text' : 'password';
    button.textContent = input.type === 'password' ? 'Show' : 'Hide';
  }

  function saveKeys() {
    chrome.storage.local.set({
      gemini_api_key: geminiKeyInput.value.trim(),
      openrouter_api_key: openrouterKeyInput.value.trim()
    }, () => {
      saveKeysBtn.textContent = 'Saved';
      setTimeout(() => { saveKeysBtn.textContent = 'Save Keys'; }, 1400);
    });
  }

  function clearKeys() {
    chrome.storage.local.remove(['gemini_api_key', 'openrouter_api_key'], () => {
      geminiKeyInput.value = '';
      openrouterKeyInput.value = '';
      clearKeysBtn.textContent = 'Cleared';
      setTimeout(() => { clearKeysBtn.textContent = 'Clear'; }, 1400);
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
});
