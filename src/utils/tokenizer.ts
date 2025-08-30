// Token counting implementation that uses service worker for WASM operations

export async function countTokens(
  text: string,
  provider: 'claude' | 'chatgpt'
): Promise<number> {
  try {
    // Send message to service worker for token counting
    const response = await chrome.runtime.sendMessage({
      type: 'COUNT_TOKENS',
      text,
      provider
    });

    if (response.success) {
      return response.count;
    } else {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('Token count error:', error);
    // Fallback to approximation
    const fallbackCount = Math.ceil(text.length / 4);
    console.warn(`[FALLBACK] Using approximation: ${text.length} chars -> ${fallbackCount} tokens`);
    return fallbackCount;
  }
}

// Export approximation function as well
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
