// Content script for ChatGPT
import { countTokens } from '../utils/tokenizer';
import { GPT_MODELS_FREE, GPT_MODELS_PLUS, GPT_MODELS_PRO } from '../utils/constants';
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
    '[data-testid="model-selector"]',
    'button:has-text("GPT")',
    'button:has-text("o3")',
    'button:has-text("o4")',
  ],
  // Plan indicators
  planIndicators: [
    '[href="/gpts"]', // GPTs menu indicates Plus or higher
    'button[aria-label*="GPT-5"]',
    'nav a[href*="/gpts"]',
    '[data-testid="plus-badge"]',
    '[data-testid="pro-badge"]',
    'text:has-text("Plus")',
    'text:has-text("Pro")',
  ],
  // Main content area
  mainContent: [
    'main',
    'div[role="main"]',
    '#__next main',
  ],
};

type ChatGPTPlan = 'free' | 'plus' | 'pro';

class ChatGPTContextTracker {
  private observer: MutationObserver | null = null;
  private contextIndicator: ReturnType<typeof createContextIndicator>;
  private currentModel: string = 'gpt-5-fast'; // Default model
  private currentPlan: ChatGPTPlan = 'free'; // Default to free plan
  private tokenCache: Map<string, number> = new Map();
  private currentUrl: string = window.location.href;
  private scrollListener: (() => void) | null = null;
  private hasScrollableContent: boolean = false;
  private calculateDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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
    
    // Show initial loading state
    const models = this.getAvailableModels();
    const maxTokens = models[this.currentModel] || 16385;
    this.contextIndicator.update(0, maxTokens, false, true); // Show loading state
    
    // Detect user plan FIRST before calculating
    this.detectUserPlan();
    
    // Observe model changes
    this.observeModelChanges();
    
    // Start observing chat changes
    this.observeChat();
    
    // Initial calculation AFTER plan detection
    setTimeout(() => {
      this.calculateContextDebounced();
    }, 100);
    
    // Watch for URL changes (chat switches)
    this.observeUrlChanges();
    
    // Set up mutation observer for model selector changes
    this.observeModelSelectorChanges();
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
    
    // Check if only the model parameter changed (not a real chat switch)
    const oldUrlWithoutModel = this.currentUrl.replace(/[?&]model=[^&]*/, '');
    const newUrlWithoutModel = newUrl.replace(/[?&]model=[^&]*/, '');
    
    if (oldUrlWithoutModel === newUrlWithoutModel) {
      // Only model changed, not the chat - just update URL and return
      this.currentUrl = newUrl;
      return;
    }
    
    console.log('Chat switched, resetting context tracker');
    this.currentUrl = newUrl;
    
    // Show loading state immediately
    const models = this.getAvailableModels();
    const maxTokens = models[this.currentModel] || 16385; // Default to a reasonable value
    this.contextIndicator.update(0, maxTokens, false, true); // Show loading state
    
    // Clear token cache for new chat
    this.tokenCache.clear();
    
    // Disconnect existing observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    
    // Re-observe the new chat with multiple retries to ensure content is loaded
    let retries = 0;
    const maxRetries = 10;
    const retryInterval = setInterval(() => {
      retries++;
      // Check if chat content has loaded
      const messages = this.querySelectorAll([...SELECTORS.userMessages, ...SELECTORS.assistantMessages]);
      const hasNewChat = window.location.href.includes('/c/') || window.location.href === 'https://chatgpt.com/';
      
      if (messages.length > 0 || hasNewChat || retries >= maxRetries) {
        clearInterval(retryInterval);
        this.observeChat();
        this.calculateContextDebounced();
        this.detectUserPlan();
        this.observeModelChanges();
        
        // Force another calculation after a delay to catch any late-loading content
        setTimeout(() => {
          this.calculateContextDebounced();
        }, 1500);
      }
    }, 300);
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
      this.calculateContextDebounced();
    });

    this.observer.observe(chatContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Set up scroll listener
    this.setupScrollListener(chatContainer);
  }

  private setupScrollListener(container: Element) {
    // Remove existing listener if any
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true);
      this.scrollListener = null;
    }

    // Find the scrollable parent
    const findScrollableParent = (el: Element): Element | null => {
      let parent = el.parentElement;
      while (parent) {
        const computedStyle = window.getComputedStyle(parent);
        if (computedStyle.overflowY === 'auto' || computedStyle.overflowY === 'scroll') {
          return parent;
        }
        parent = parent.parentElement;
      }
      return null;
    };

    const scrollableElement = findScrollableParent(container) || container.closest('main');
    if (scrollableElement) {
      // Check if content is scrollable
      const checkScrollable = () => {
        this.hasScrollableContent = scrollableElement.scrollHeight > scrollableElement.clientHeight;
        console.log('Scrollable content detected:', this.hasScrollableContent);
      };

      checkScrollable();

      this.scrollListener = () => {
        checkScrollable();
        this.calculateContextDebounced();
      };
      
      // Listen for scroll events
      scrollableElement.addEventListener('scroll', this.scrollListener, { passive: true });
      
      // Also check when DOM changes
      setTimeout(() => checkScrollable(), 1000);
    }
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

  private detectUserPlan() {
    // Check for plan indicators in the UI
    const hasGPTsMenu = document.querySelector('[href="/gpts"]') !== null ||
                       document.querySelector('a[href="/gpts"]') !== null;
    
    // Look for Plus/Pro text in profile or anywhere on page
    const plusElements = Array.from(document.querySelectorAll('*')).filter(el => 
      el.textContent?.trim() === 'Plus' && el.children.length === 0
    );
    const proElements = Array.from(document.querySelectorAll('*')).filter(el => 
      el.textContent?.trim() === 'Pro' && el.children.length === 0
    );
    
    const hasPlusIndicator = plusElements.length > 0 || document.body.textContent?.includes('Plus') || false;
    const hasProIndicator = proElements.length > 0 || document.body.textContent?.includes('Pro') || false;
    
    // Check for model availability - Pro users have access to GPT-5 Pro mode
    const hasProModel = document.querySelector('[aria-label*="Pro"]') !== null ||
                       Array.from(document.querySelectorAll('button')).some(btn => btn.textContent?.includes('Pro')) || false;
    
    // Check for Thinking mode availability (Plus and Pro) - look in model selector
    const hasThinkingMode = document.querySelector('[aria-label*="Thinking"]') !== null ||
                           Array.from(document.querySelectorAll('button')).some(btn => btn.textContent?.includes('Thinking')) || false;
    
    // Check for other Plus/Pro features
    const hasCodex = document.querySelector('[href="/codex"]') !== null;
    const hasSora = document.querySelector('[href*="sora"]') !== null;
    
    if (hasProModel || (hasProIndicator && !hasPlusIndicator)) {
      this.currentPlan = 'pro';
      console.log('Detected ChatGPT Pro plan');
    } else if (hasGPTsMenu || hasPlusIndicator || hasThinkingMode || hasCodex || hasSora) {
      this.currentPlan = 'plus';
      console.log('Detected ChatGPT Plus plan');
    } else {
      this.currentPlan = 'free';
      console.log('Detected ChatGPT Free plan');
    }
  }

  private updateModel(modelText: string) {
    const text = modelText.toLowerCase();
    // Parse model from text based on new model names
    if (text.includes('thinking')) {
      this.currentModel = 'gpt-5-thinking';
    } else if (text.includes('pro') && this.currentPlan === 'pro') {
      this.currentModel = 'gpt-5-pro';
    } else if (text.includes('fast') || text.includes('instant') || text.includes('gpt-5')) {
      this.currentModel = 'gpt-5-fast';
    } else if (text.includes('o3')) {
      this.currentModel = 'o3';
    } else if (text.includes('o4-mini') || text.includes('o4 mini')) {
      this.currentModel = 'o4-mini';
    } else if (text.includes('gpt-4o') || text.includes('4o')) {
      this.currentModel = 'gpt-4o';
    } else {
      // Default to fast mode
      this.currentModel = 'gpt-5-fast';
    }
    console.log('Detected model:', this.currentModel);
  }

  private calculateContextDebounced() {
    // Clear any existing timer
    if (this.calculateDebounceTimer) {
      clearTimeout(this.calculateDebounceTimer);
    }
    
    // Set a new timer to calculate after a short delay
    this.calculateDebounceTimer = setTimeout(() => {
      this.calculateContext();
    }, 100); // 100ms debounce
  }

  private async calculateContext() {
    try {
      // Get all messages - try multiple selectors including article-based
      const userMessages = this.querySelectorAll(SELECTORS.userMessages);
      const assistantMessages = this.querySelectorAll(SELECTORS.assistantMessages);
      
      // Fallback: Check for article elements with h5/h6 headers
      let allUserMessages = [...userMessages];
      let allAssistantMessages = [...assistantMessages];
      
      if (allUserMessages.length === 0 && allAssistantMessages.length === 0) {
        // Try article-based detection
        const articles = document.querySelectorAll('article');
        articles.forEach(article => {
          const heading = article.querySelector('h5, h6');
          if (heading) {
            if (heading.textContent?.includes('You said')) {
              allUserMessages.push(article);
            } else if (heading.textContent?.includes('ChatGPT said')) {
              allAssistantMessages.push(article);
            }
          }
        });
      }
      
      let totalTokens = 0;
      const hasMessages = allUserMessages.length > 0 || allAssistantMessages.length > 0;
      
      // Count tokens in user messages
      for (const msg of allUserMessages) {
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
      for (const msg of allAssistantMessages) {
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
      
      // Only add system prompt estimate if there are actual messages
      if (hasMessages) {
        // Add system prompt estimate (ChatGPT typically uses ~500-1000 tokens)
        totalTokens += 750;
      }
      
      // Get model limits based on plan
      let modelLimits: { [key: string]: number };
      switch (this.currentPlan) {
        case 'pro':
          modelLimits = GPT_MODELS_PRO;
          break;
        case 'plus':
          modelLimits = GPT_MODELS_PLUS;
          break;
        default:
          modelLimits = GPT_MODELS_FREE;
      }
      
      // Update indicator with scroll warning if needed
      const maxTokens = modelLimits[this.currentModel] || modelLimits['gpt-5-fast'] || 16000;
      this.contextIndicator.update(totalTokens, maxTokens, this.hasScrollableContent);
      console.log(`Context: ${totalTokens}/${maxTokens} tokens (${this.currentPlan} plan, ${this.currentModel} model)`);
      
      // Clear old cache entries to prevent memory leaks
      if (this.tokenCache.size > 1000) {
        const entriesToKeep = Array.from(this.tokenCache.entries()).slice(-500);
        this.tokenCache = new Map(entriesToKeep);
      }
    } catch (error) {
      console.error('Error calculating context:', error);
    }
  }

  private observeModelSelectorChanges() {
    // Watch for clicks on the model selector button and changes to its content
    const checkForModelChanges = () => {
      const modelSelector = this.querySelector(SELECTORS.modelSelector);
      if (modelSelector) {
        // Create observer for the model selector button text changes
        const modelObserver = new MutationObserver(() => {
          const modelText = modelSelector.textContent || '';
          const ariaLabel = modelSelector.getAttribute('aria-label') || '';
          const newModel = modelText || ariaLabel;
          
          // Update model and recalculate if changed
          const prevModel = this.currentModel;
          this.updateModel(newModel);
          
          if (prevModel !== this.currentModel) {
            console.log(`Model changed from ${prevModel} to ${this.currentModel}`);
            this.calculateContextDebounced();
          }
        });
        
        modelObserver.observe(modelSelector, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['aria-label']
        });
        
      } else {
        // Retry if model selector not found yet
        setTimeout(() => checkForModelChanges(), 1000);
      }
    };
    
    checkForModelChanges();
  }

  public destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true);
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