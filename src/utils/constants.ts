export const BUFFER_PERCENTAGE = 0.1; // 10% safety buffer

export const CLAUDE_MODELS: { [key: string]: number } = {
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-2.1': 200000,
  'claude-2': 100000,
  'claude-instant': 100000
};

export const GPT_MODELS: { [key: string]: number } = {
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 4096,
  'gpt-3.5-turbo-16k': 16385
};


export const COLOR_THRESHOLDS = {
  GREEN: 0.7,   // 0-70%
  YELLOW: 0.9,  // 70-90%
  RED: 1.0      // 90-100%
};

export const COLORS = {
  GREEN: '#22c55e',
  YELLOW: '#eab308',
  RED: '#ef4444',
  OVERFLOW: '#dc2626'
};