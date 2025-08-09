// Content script for Claude.ai
import { countTokens } from '../utils/tokenizer';
import { CLAUDE_MODELS } from '../utils/constants';
import { createContextIndicator } from '../components/ContextIndicator';

// Selectors for Claude.ai interface elements
const SELECTORS = {
  // Main chat container - fallback approaches for finding conversation area
  chatContainer: [
    '[data-testid="conversation-turns"]', // Original selector
    'div:has([data-testid^="user-"]), div:has([data-testid^="assistant-"])', // Container with messages
    '.flex-1\\. > div', // Chat content area
    '.relative.mx-auto.max-w-3xl', // Main content wrapper
  ],
  // Individual message elements
  userMessage: '[data-testid^="user-"]:not([data-testid="user-menu-button"])',
  assistantMessage: [
    '[data-testid^="assistant-"]', // Original selector
    '.font-claude-message', // Claude message styling class
    'div.group.relative:has(.font-claude-message)', // Message container
    'div:has(> div.font-claude-message)', // Parent container
  ],
  // Input field
  inputField: ['div[contenteditable="true"]', 'textarea', '[role="textbox"]'],
  // Model selector (if visible)
  modelSelector: ['[data-testid="model-selector"]', 'button:has(img[alt*="Claude"])', 'button:contains("Sonnet"), button:contains("Opus"), button:contains("Haiku")'],
  // Main content area - fallback approaches
  mainContent: ['main', 'body', '.flex.min-h-screen.w-full', '.relative.mx-auto.max-w-3xl'],
};

class ClaudeContextTracker {
  private observer: MutationObserver | null = null;
  private contextIndicator: ReturnType<typeof createContextIndicator>;
  private currentModel: string = 'claude-3-opus'; // Default model
  private tokenCache: Map<string, number> = new Map();
  private currentUrl: string = window.location.href;
  private calculationTimeout: NodeJS.Timeout | null = null;
  private isCalculating: boolean = false;
  private retryCount: number = 0;
  private maxRetries: number = 5;

  constructor() {
    this.contextIndicator = createContextIndicator();
    this.init();
  }

  // Helper function to find elements using fallback selectors
  private findElement(selectors: string | string[]): Element | null {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    
    for (const selector of selectorArray) {
      try {
        const element = document.querySelector(selector);
        if (element) return element;
      } catch (e) {
        // Skip invalid selectors (like CSS4 :has() in older browsers)
        continue;
      }
    }
    return null;
  }

  // Helper function to find ALL elements using fallback selectors
  private findAllElements(selectors: string | string[]): Element[] {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    const allElements: Element[] = [];
    
    for (const selector of selectorArray) {
      try {
        const elements = document.querySelectorAll(selector);
        allElements.push(...Array.from(elements));
      } catch (e) {
        // Skip invalid selectors (like CSS4 :has() in older browsers)
        continue;
      }
    }
    
    // Remove duplicates by using Set with element references
    return Array.from(new Set(allElements));
  }

  private init() {
    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  private setup() {
    // Insert context indicator into page
    this.insertIndicator();
    
    // Start observing chat changes
    this.observeChat();
    
    // Initial calculation
    this.calculateContext();
    
    // Observe model changes if selector exists
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
      this.retryCount = 0; // Reset retry count for new chat
      this.insertIndicator(); // Make sure indicator is inserted
      this.observeChat();
      this.scheduleCalculation(); // Use scheduled calculation instead of direct call
      this.observeModelChanges();
    }, 500); // Give the new chat time to load
  }

  private insertIndicator() {
    // Remove existing indicator if it exists
    const existingIndicator = document.querySelector('#ai-context-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }

    // Find a suitable place to insert the indicator
    const targetElement = this.findElement(SELECTORS.mainContent);
    if (targetElement) {
      targetElement.appendChild(this.contextIndicator);
      console.log('Context indicator inserted successfully into:', targetElement.tagName, targetElement.className);
    } else {
      console.warn('Could not find suitable element to insert context indicator');
      // Try a direct body insertion as fallback
      console.log('Trying fallback insertion to body');
      document.body.appendChild(this.contextIndicator);
      console.log('Context indicator inserted into body as fallback');
    }
  }

  private observeChat() {
    const chatContainer = this.findElement(SELECTORS.chatContainer);
    if (!chatContainer) {
      // Retry after a delay if chat container not found, but limit retries
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`Chat container not found, retrying... (${this.retryCount}/${this.maxRetries})`);
        setTimeout(() => this.observeChat(), 1000);
      } else {
        console.log('Max retries reached, skipping chat container observation');
      }
      return;
    }

    console.log('Found chat container, setting up observer');
    this.observer = new MutationObserver(() => {
      this.scheduleCalculation();
    });

    this.observer.observe(chatContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private observeModelChanges() {
    const modelSelector = this.findElement(SELECTORS.modelSelector);
    if (modelSelector) {
      // Extract model from selector
      const modelText = modelSelector.textContent || '';
      this.updateModel(modelText);
      console.log('Detected model:', modelText);
    }
  }

  private updateModel(modelText: string) {
    // Parse model from text
    if (modelText.toLowerCase().includes('opus')) {
      this.currentModel = 'claude-3-opus';
    } else if (modelText.toLowerCase().includes('sonnet')) {
      this.currentModel = 'claude-3-sonnet';
    } else if (modelText.toLowerCase().includes('haiku')) {
      this.currentModel = 'claude-3-haiku';
    } else if (modelText.toLowerCase().includes('claude-2')) {
      this.currentModel = 'claude-2';
    }
  }

  private scheduleCalculation() {
    // Clear existing timeout to prevent multiple rapid calculations
    if (this.calculationTimeout) {
      clearTimeout(this.calculationTimeout);
    }
    
    // Skip if already calculating
    if (this.isCalculating) {
      return;
    }
    
    // Schedule calculation with debouncing (500ms delay)
    this.calculationTimeout = setTimeout(() => {
      this.calculateContext();
    }, 500);
  }

  private async calculateContext() {
    // Prevent multiple simultaneous calculations
    if (this.isCalculating) {
      return;
    }
    
    try {
      this.isCalculating = true;
      
      // Get all messages
      const userMessages = document.querySelectorAll(SELECTORS.userMessage);
      const assistantMessages = this.findAllElements(SELECTORS.assistantMessage);
      
      let totalTokens = 0;
      
      console.log(`Found ${userMessages.length} user messages and ${assistantMessages.length} assistant messages`);
      
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
          console.log(`User message tokens: ${tokens} for text: ${text.substring(0, 50)}...`);
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
          console.log(`Assistant message tokens: ${tokens} for text: ${text.substring(0, 50)}...`);
        }
      }
      
      // Get current input
      const inputField = this.findElement(SELECTORS.inputField);
      if (inputField) {
        const inputText = (inputField as HTMLElement).textContent || (inputField as HTMLInputElement).value || '';
        if (inputText && inputText !== 'Reply to Claude...' && inputText !== 'Write your prompt to Claude') {
          totalTokens += await countTokens(inputText);
        }
      }
      
      // Update indicator
      const maxTokens = CLAUDE_MODELS[this.currentModel] || 200000;
      this.contextIndicator.update(totalTokens, maxTokens);
      
      // Clear old cache entries to prevent memory leaks
      if (this.tokenCache.size > 1000) {
        const entriesToKeep = Array.from(this.tokenCache.entries()).slice(-500);
        this.tokenCache = new Map(entriesToKeep);
      }
    } catch (error) {
      console.error('Error calculating context:', error);
    } finally {
      this.isCalculating = false;
    }
  }

  public destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.calculationTimeout) {
      clearTimeout(this.calculationTimeout);
    }
    this.contextIndicator.removeIndicator();
  }
}

// Initialize tracker with singleton pattern
let tracker: ClaudeContextTracker | null = null;

// Check if indicator already exists to prevent duplicates
const existingIndicator = document.querySelector('#ai-context-indicator');
if (!existingIndicator && !tracker) {
  tracker = new ClaudeContextTracker();
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