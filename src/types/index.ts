export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface TokenCount {
  current: number;
  max: number;
  percentage: number;
  isOverflow: boolean;
}

export interface ModelConfig {
  name: string;
  maxTokens: number;
  identifier: string;
}

export interface ContextIndicatorState {
  currentTokens: number;
  maxTokens: number;
  percentage: number;
  color: string;
  isFlashing: boolean;
}