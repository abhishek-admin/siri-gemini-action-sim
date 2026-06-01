const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';

const OPENROUTER_MODELS = [
  'google/gemini-2.5-flash',
  'google/gemini-2.0-flash',
  'deepseek/deepseek-v4-flash:free',
  'meta-llama/llama-3.3-70b-instruct:free'
];

async function getStoredKey(name) {
  return new Promise((resolve) => {
    chrome.storage.local.get([name], (result) => resolve(result[name] || null));
  });
}

async function callGeminiDirect(prompt, options = {}) {
  const apiKey = await getStoredKey('gemini_api_key');
  if (!apiKey) throw new Error('No Gemini key saved. Open settings and paste a key from AI Studio.');

  const model = options.model || DEFAULT_MODEL;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: options.maxTokens || 2200,
      temperature: options.temperature ?? 0.35
    }
  };

  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }

  if (options.responseType === 'json') {
    body.generationConfig.responseMimeType = 'application/json';
  }

  const response = await fetch(`${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error?.message || `Gemini API error ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

async function callOpenRouter(prompt, options = {}) {
  const apiKey = await getStoredKey('openrouter_api_key');
  if (!apiKey) throw new Error('No OpenRouter fallback key saved.');

  let lastError = null;
  for (const model of OPENROUTER_MODELS) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/abhishek-admin',
          'X-Title': 'Siri-Gemini Action Simulator'
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(options.systemInstruction ? [{ role: 'system', content: options.systemInstruction }] : []),
            { role: 'user', content: prompt }
          ],
          max_tokens: options.maxTokens || 2200,
          temperature: options.temperature ?? 0.35
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        lastError = new Error(error?.error?.message || `${model}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) return text;
      lastError = new Error(`${model}: empty response`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('All OpenRouter fallback models failed.');
}

async function callGemini(prompt, options = {}) {
  const geminiKey = await getStoredKey('gemini_api_key');
  const openRouterKey = await getStoredKey('openrouter_api_key');

  if (!geminiKey && !openRouterKey) {
    throw new Error('No API key saved. Add a Gemini key or OpenRouter fallback key in settings.');
  }

  if (!geminiKey && openRouterKey) return callOpenRouter(prompt, options);

  try {
    return await callGeminiDirect(prompt, options);
  } catch (error) {
    const message = error.message.toLowerCase();
    const canFallback =
      openRouterKey &&
      (message.includes('quota') ||
        message.includes('rate') ||
        message.includes('429') ||
        message.includes('limit') ||
        message.includes('exhausted'));

    if (canFallback) return callOpenRouter(prompt, options);
    throw error;
  }
}
