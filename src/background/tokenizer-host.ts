// Shared tokenization logic for both Chrome service worker and Firefox event page
import { Tiktoken, init } from 'tiktoken/lite/init';
import o200k_base from 'tiktoken/encoders/o200k_base.json';
import claudeEncoding from '@anthropic-ai/tokenizer/dist/cjs/claude.json';

let claudeEncoder: Tiktoken | null = null;
let gptEncoder: Tiktoken | null = null;
let initPromise: Promise<void> | null = null;

// Get runtime API that works in both Chrome and Firefox
const runtime = (globalThis as any).browser ?? (globalThis as any).chrome;

async function loadWasm() {
  const url = runtime.runtime.getURL('wasm/tiktoken_bg.wasm');
  
  return await init(async (imports) => {
    const response = await fetch(url);
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, imports);
    return result;
  });
}

async function ensureInit() {
  if (!initPromise) {
    initPromise = loadWasm();
  }
  return initPromise;
}

async function getClaudeEncoder() {
  if (!claudeEncoder) {
    await ensureInit();
    claudeEncoder = new Tiktoken(
      claudeEncoding.bpe_ranks,
      claudeEncoding.special_tokens,
      claudeEncoding.pat_str
    );
  }
  return claudeEncoder;
}

async function getGPTEncoder() {
  if (!gptEncoder) {
    await ensureInit();
    gptEncoder = new Tiktoken(
      o200k_base.bpe_ranks,
      o200k_base.special_tokens,
      o200k_base.pat_str
    );
  }
  return gptEncoder;
}

export function installMessageHandler() {
  runtime.runtime.onMessage.addListener((request: any, sender: any, sendResponse: any) => {
    if (request.type === 'COUNT_TOKENS') {
      (async () => {
        try {
          const { text, provider } = request;
          let count: number;
          
          if (provider === 'claude') {
            const encoder = await getClaudeEncoder();
            count = encoder.encode(text).length;
            console.log(`[Claude Tokenizer] Text: "${text.substring(0, 50)}..." -> ${count} tokens`);
          } else {
            const encoder = await getGPTEncoder();
            count = encoder.encode(text).length;
            console.log(`[GPT o200k_base] Text: "${text.substring(0, 50)}..." -> ${count} tokens`);
          }
          
          sendResponse({ success: true, count });
        } catch (error: any) {
          console.error('Token count error in background:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      
      return true; // Will respond asynchronously
    }
  });
}