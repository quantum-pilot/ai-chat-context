// Content script for ChatGPT
import { countTokens } from '../utils/tokenizer';
import { GPT_MODELS_FREE, GPT_MODELS_PLUS, GPT_MODELS_PRO } from '../utils/constants';
import { createContextIndicator } from '../components/ContextIndicator';

// Selectors for ChatGPT interface elements
const SELECTORS = {
  // Main chat container - multiple possible selectors
  chatContainer: [
    'main', // Try main element first
    'main > div', // Direct child of main
    'div.flex.flex-col.items-center', // Conversation area
    'div[class*="react-scroll"]',
    'div[class*="conversation"]',
    '#__next main', // Next.js main content
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
    '#__next',
    'body',
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
  private calculateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private hasCompletedInitialLoad: boolean = false;

  constructor() {
    this.contextIndicator = createContextIndicator('chatgpt');
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

    // For new/empty chats, just show 0 immediately
    const models = GPT_MODELS_FREE; // Default to free models initially
    const maxTokens = models[this.currentModel] || 16385;

    // Check if there are any messages first
    const hasMessages = this.querySelectorAll([...SELECTORS.userMessages, ...SELECTORS.assistantMessages]).length > 0;

    if (hasMessages) {
      // Show loading state only if there are messages to calculate
      this.contextIndicator.update(0, maxTokens, true);
    } else {
      // New chat - just show 0
      this.contextIndicator.update(0, maxTokens, false);
    }

    // Detect user plan FIRST before calculating
    this.detectUserPlan();

    // Observe model changes
    this.observeModelChanges();

    // Start observing chat changes
    this.observeChat();

    // Initial calculation AFTER plan detection
    setTimeout(() => {
      this.calculateContextDebounced();
    }, 200);

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

    history.pushState = function (...args) {
      originalPushState.apply(history, args);
      setTimeout(() => {
        if (tracker) {
          tracker.handleChatSwitch();
        }
      }, 100);
    };

    history.replaceState = function (...args) {
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

    // Chat switched, resetting context tracker
    this.currentUrl = newUrl;

    // Clear token cache for new chat
    this.tokenCache.clear();

    // Reset initial load flag for new chat
    this.hasCompletedInitialLoad = false;

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

        // For chat switches, show loading state by default
        // We'll determine the actual count during calculation
        const models = GPT_MODELS_FREE; // Default to free initially
        const maxTokens = models[this.currentModel] || 16385;
        this.contextIndicator.update(0, maxTokens, true); // Show loading

        this.observeChat();
        this.calculateContextDebounced(); // Initial load for new chat
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

    // Removed scroll listener setup - no longer tracking unloaded content
  }

  // Removed setupScrollListener - no longer tracking unloaded content

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
      // Detected ChatGPT Pro plan
    } else if (hasGPTsMenu || hasPlusIndicator || hasThinkingMode || hasCodex || hasSora) {
      this.currentPlan = 'plus';
      // Detected ChatGPT Plus plan
    } else {
      this.currentPlan = 'free';
      // Detected ChatGPT Free plan
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
    // Model detected
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

      // Count tokens in user messages
      for (const msg of allUserMessages) {
        const text = msg.textContent || '';
        const cacheKey = `user-${text.substring(0, 100)}`;

        if (this.tokenCache.has(cacheKey)) {
          totalTokens += this.tokenCache.get(cacheKey)!;
        } else {
          const tokens = await countTokens(text, 'chatgpt');
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
          const tokens = await countTokens(text, 'chatgpt');
          this.tokenCache.set(cacheKey, tokens);
          totalTokens += tokens;
        }
      }

      // Get current input
      const inputField = this.querySelector(SELECTORS.inputField) as HTMLTextAreaElement | HTMLDivElement;
      if (inputField) {
        const inputText = 'value' in inputField ? inputField.value : inputField.textContent || '';
        if (inputText) {
          totalTokens += await countTokens(inputText, 'chatgpt');
        }
      }

      // Don't add system prompt estimate - we'll note the range in tooltip instead

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

      // Check if we have any messages
      const hasMessages = userMessages.length > 0 || assistantMessages.length > 0;

      // For chat switches: if this is the initial calculation and we found no messages,
      // check if this might be a chat that's still loading (not a new empty chat)
      const isNewChat = window.location.pathname === '/' || window.location.pathname.includes('/new');
      const shouldKeepLoading = !this.hasCompletedInitialLoad && !hasMessages && !isNewChat;

      // Mark initial load as complete only if we found messages or it's a new chat
      if (!this.hasCompletedInitialLoad && (hasMessages || isNewChat)) {
        this.hasCompletedInitialLoad = true;
      }

      // Update with actual count or keep loading state
      this.contextIndicator.update(totalTokens, maxTokens, shouldKeepLoading);
      // Context calculated

      // Clear old cache entries to prevent memory leaks
      if (this.tokenCache.size > 1000) {
        const entriesToKeep = Array.from(this.tokenCache.entries()).slice(-500);
        this.tokenCache = new Map(entriesToKeep);
      }
    } catch (error) {
      // Error calculating context
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
            // Model changed
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
    // Cleanup - no scroll listener needed anymore
    this.contextIndicator.removeIndicator();
  }
}

// Initialize tracker with singleton pattern
let tracker: ChatGPTContextTracker | null = null;

// Initialize when DOM is ready
function initializeTracker() {
  const existingIndicator = document.querySelector('#ai-context-indicator');
  if (!existingIndicator && !tracker) {
    tracker = new ChatGPTContextTracker();
  }
}

// Check if we're on ChatGPT
if (window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('chat.openai.com')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTracker);
  } else {
    // DOM already loaded, initialize immediately
    setTimeout(initializeTracker, 100); // Small delay to ensure page elements are ready
  }
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
