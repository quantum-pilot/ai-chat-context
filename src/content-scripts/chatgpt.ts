// Content script for ChatGPT
import { countTokens } from '../utils/tokenizer';
import { GPT_MODELS } from '../utils/constants';
import { createContextIndicator } from '../components/ContextIndicator';

// Selectors for ChatGPT interface elements
const SELECTORS = {
  // Main chat container - multiple possible selectors
  chatContainer: [
    'div[class*="react-scroll"]',
    'main div[class*="flex-col"]',
    'div[class*="conversation"]',
    'div.flex.flex-col.gap-4',
  ],
  // User messages
  userMessages: [
    'div[data-message-author-role="user"]',
    'div[class*="user-message"]',
    'div[class*="human-message"]',
    'article[data-testid*="user"]',
  ],
  // Assistant messages
  assistantMessages: [
    'div[data-message-author-role="assistant"]',
    'div[class*="assistant-message"]',
    'div[class*="bot-message"]',
    'article[data-testid*="assistant"]',
  ],
  // Input field
  inputField: [
    'textarea#prompt-textarea',
    'textarea[data-id="root"]',
    'div[contenteditable="true"]',
    'textarea[placeholder*="Send a message"]',
  ],
  // Model selector
  modelSelector: [
    'button[aria-label*="GPT"]',
    'button[aria-label*="model"]',
    'div[class*="model-selector"]',
    'button[class*="model"]',
  ],
  // Main content area
  mainContent: [
    'main',
    'div[role="main"]',
    '#__next main',
  ],
};

class ChatGPTContextTracker {
  private observer: MutationObserver | null = null;
  private contextIndicator: ReturnType<typeof createContextIndicator>;
  private currentModel: string = 'gpt-4'; // Default model
  private tokenCache: Map<string, number> = new Map();
  private currentUrl: string = window.location.href;

  constructor() {
    this.contextIndicator = createContextIndicator();
    this.init();
  }

  private init() {
    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  private querySelector(selectors: string[]): Element | null {
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) return element;
      } catch (e) {
        // Invalid selector, continue
      }
    }
    return null;
  }

  private querySelectorAll(selectors: string[]): Element[] {
    const elements: Element[] = [];
    for (const selector of selectors) {
      try {
        const found = document.querySelectorAll(selector);
        elements.push(...Array.from(found));
      } catch (e) {
        // Invalid selector, continue
      }
    }
    // Remove duplicates
    return Array.from(new Set(elements));
  }

  private setup() {
    // Insert context indicator into page
    this.insertIndicator();
    
    // Start observing chat changes
    this.observeChat();
    
    // Initial calculation
    this.calculateContext();
    
    // Observe model changes
    this.observeModelChanges();
    
    // Watch for URL changes (chat switches)
    this.observeUrlChanges();
  }

  private observeUrlChanges() {
    // Check for URL changes periodically (for SPA navigation)
    setInterval(() => {
      if (window.location.href !== this.currentUrl) {
        this.handleChatSwitch();
      }
    }, 500);

    // Also listen for popstate events
    window.addEventListener('popstate', () => {
      this.handleChatSwitch();
    });

    // Listen for pushstate/replacestate
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      setTimeout(() => {
        if (tracker) {
          tracker.handleChatSwitch();
        }
      }, 100);
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      setTimeout(() => {
        if (tracker) {
          tracker.handleChatSwitch();
        }
      }, 100);
    };
  }

  private handleChatSwitch() {
    const newUrl = window.location.href;
    if (newUrl === this.currentUrl) return;
    
    console.log('Chat switched, resetting context tracker');
    this.currentUrl = newUrl;
    
    // Clear token cache for new chat
    this.tokenCache.clear();
    
    // Disconnect existing observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // Re-observe the new chat
    setTimeout(() => {
      this.observeChat();
      this.calculateContext();
      this.observeModelChanges();
    }, 500); // Give the new chat time to load
  }

  private insertIndicator() {
    // Find a suitable place to insert the indicator
    const targetElement = this.querySelector(SELECTORS.mainContent);
    if (targetElement) {
      targetElement.appendChild(this.contextIndicator);
    } else {
      // Fallback to body if main not found
      document.body.appendChild(this.contextIndicator);
    }
  }

  private observeChat() {
    const chatContainer = this.querySelector(SELECTORS.chatContainer);
    if (!chatContainer) {
      // Retry after a delay if chat container not found
      setTimeout(() => this.observeChat(), 1000);
      return;
    }

    this.observer = new MutationObserver(() => {
      this.calculateContext();
    });

    this.observer.observe(chatContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private observeModelChanges() {
    const modelSelector = this.querySelector(SELECTORS.modelSelector);
    if (modelSelector) {
      // Extract model from selector
      const modelText = modelSelector.textContent || '';
      this.updateModel(modelText);
      
      // Also check aria-label
      const ariaLabel = modelSelector.getAttribute('aria-label') || '';
      if (ariaLabel) {
        this.updateModel(ariaLabel);
      }
    }
  }

  private updateModel(modelText: string) {
    const text = modelText.toLowerCase();
    // Parse model from text
    if (text.includes('gpt-4-turbo') || text.includes('gpt-4-128k')) {
      this.currentModel = 'gpt-4-turbo';
    } else if (text.includes('gpt-4-32k')) {
      this.currentModel = 'gpt-4-32k';
    } else if (text.includes('gpt-4')) {
      this.currentModel = 'gpt-4';
    } else if (text.includes('gpt-3.5-turbo-16k')) {
      this.currentModel = 'gpt-3.5-turbo-16k';
    } else if (text.includes('gpt-3.5')) {
      this.currentModel = 'gpt-3.5-turbo';
    }
  }

  private async calculateContext() {
    try {
      // Get all messages
      const userMessages = this.querySelectorAll(SELECTORS.userMessages);
      const assistantMessages = this.querySelectorAll(SELECTORS.assistantMessages);
      
      let totalTokens = 0;
      
      // Count tokens in user messages
      for (const msg of userMessages) {
        const text = msg.textContent || '';
        const cacheKey = `user-${text.substring(0, 100)}`;
        
        if (this.tokenCache.has(cacheKey)) {
          totalTokens += this.tokenCache.get(cacheKey)!;
        } else {
          const tokens = await countTokens(text);
          this.tokenCache.set(cacheKey, tokens);
          totalTokens += tokens;
        }
      }
      
      // Count tokens in assistant messages
      for (const msg of assistantMessages) {
        const text = msg.textContent || '';
        const cacheKey = `assistant-${text.substring(0, 100)}`;
        
        if (this.tokenCache.has(cacheKey)) {
          totalTokens += this.tokenCache.get(cacheKey)!;
        } else {
          const tokens = await countTokens(text);
          this.tokenCache.set(cacheKey, tokens);
          totalTokens += tokens;
        }
      }
      
      // Get current input
      const inputField = this.querySelector(SELECTORS.inputField) as HTMLTextAreaElement | HTMLDivElement;
      if (inputField) {
        const inputText = 'value' in inputField ? inputField.value : inputField.textContent || '';
        if (inputText) {
          totalTokens += await countTokens(inputText);
        }
      }
      
      // Add system prompt estimate (ChatGPT typically uses ~500-1000 tokens)
      totalTokens += 750;
      
      // Update indicator
      const maxTokens = GPT_MODELS[this.currentModel] || 8192;
      this.contextIndicator.update(totalTokens, maxTokens);
      
      // Clear old cache entries to prevent memory leaks
      if (this.tokenCache.size > 1000) {
        const entriesToKeep = Array.from(this.tokenCache.entries()).slice(-500);
        this.tokenCache = new Map(entriesToKeep);
      }
    } catch (error) {
      console.error('Error calculating context:', error);
    }
  }

  public destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.contextIndicator.removeIndicator();
  }
}

// Initialize tracker with singleton pattern
let tracker: ChatGPTContextTracker | null = null;

// Check if indicator already exists to prevent duplicates
const existingIndicator = document.querySelector('#ai-context-indicator');
if (!existingIndicator && !tracker) {
  tracker = new ChatGPTContextTracker();
}

// Clean up on page unload
window.addEventListener('unload', () => {
  if (tracker) {
    tracker.destroy();
    tracker = null;
  }
});

// Also clean up on navigation within SPA
window.addEventListener('beforeunload', () => {
  if (tracker) {
    tracker.destroy();
    tracker = null;
  }
});