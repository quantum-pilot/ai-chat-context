import { countTokens as countClaudeTokens } from '@anthropic-ai/tokenizer';
import { Tiktoken, init } from 'tiktoken/lite/init';

let encoder: Tiktoken | null = null;
let initialized = false;
let encodingData: any = null;

async function getEncoder(): Promise<Tiktoken> {
  if (!initialized) {
    // Load WASM file from extension resources
    const wasmUrl = chrome.runtime.getURL('wasm/tiktoken_bg.wasm');
    const wasmResponse = await fetch(wasmUrl);
    const wasmBuffer = await wasmResponse.arrayBuffer();

    await init((imports) => WebAssembly.instantiate(wasmBuffer, imports));
    initialized = true;
  }

  if (!encodingData) {
    // Load o200k_base encoding JSON from extension resources
    const encodingUrl = chrome.runtime.getURL('encodings/o200k_base.json');
    const encodingResponse = await fetch(encodingUrl);
    encodingData = await encodingResponse.json();
  }

  if (!encoder) {
    // Use o200k_base for modern OpenAI models (GPT-4o, o1, etc.)
    encoder = new Tiktoken(
      encodingData.bpe_ranks,
      encodingData.special_tokens,
      encodingData.pat_str
    );
  }
  return encoder;
}

export async function countTokens(text: string, provider: 'claude' | 'chatgpt'): Promise<number> {
  try {
    if (provider === 'claude') {
      // Use Anthropic's tokenizer for Claude
      return countClaudeTokens(text);
    } else {
      // Use tiktoken (same WASM version that @anthropic-ai/tokenizer uses) for ChatGPT
      const enc = await getEncoder();
      const tokens = enc.encode(text);
      return tokens.length;
    }
  } catch (error) {
    console.error('Error counting tokens:', error);
    // Fallback estimation
    return Math.ceil(text.length / 4);
  }
}

export async function estimateTokensFromDOM(element: HTMLElement, provider: 'claude' | 'chatgpt'): Promise<number> {
  const text = element.innerText || element.textContent || '';
  return countTokens(text, provider);
}
