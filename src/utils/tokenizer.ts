import { getEncoding, Tiktoken } from 'js-tiktoken';

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = getEncoding('cl100k_base');
  }
  return encoder;
}

export async function countTokens(text: string): Promise<number> {
  try {
    const enc = getEncoder();
    const tokens = enc.encode(text);
    return tokens.length;
  } catch (error) {
    console.error('Error counting tokens:', error);
    // Fallback estimation
    return Math.ceil(text.length / 4);
  }
}

export async function estimateTokensFromDOM(element: HTMLElement): Promise<number> {
  const text = element.innerText || element.textContent || '';
  return countTokens(text);
}