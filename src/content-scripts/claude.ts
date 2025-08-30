// Content script for Claude.ai
import { countTokens } from '../utils/tokenizer';
import { CLAUDE_MODELS } from '../utils/constants';
import { createContextIndicator } from '../components/ContextIndicator';

// Selectors for Claude.ai interface elements
const SELECTORS = {
  // Main chat container - fallback approaches for finding conversation area
  chatContainer: [
    '[data-testid="conversation-turns"]', // Original selector
    'div.flex.flex-col:has(div[data-testid^="user-"])', // Flex container with user messages
    'div.flex.flex-col:has(div[data-testid^="assistant-"])', // Flex container with assistant messages
    'main div.flex.flex-col', // Main flex column in chat area
    'main > div > div', // Main content area
    '.relative.mx-auto', // Content wrapper
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
  inputField: ['.ProseMirror', 'div[contenteditable="true"]', 'textarea', '[role="textbox"]'],
  // Model selector (if visible)
  modelSelector: ['[data-testid="model-selector"]', 'button:has(img[alt*="Claude"])', 'button:contains("Sonnet"), button:contains("Opus"), button:contains("Haiku")'],
  // Main content area - fallback approaches
  mainContent: ['main', '#__next', 'div.flex.min-h-screen', 'body'],
};

class ClaudeContextTracker {
  private observer: MutationObserver | null = null;
  private inputObserver: MutationObserver | null = null;
  private contextIndicator: ReturnType<typeof createContextIndicator>;
  private currentModel: string = 'claude-sonnet-4'; // Default to latest model
  private tokenCache: Map<string, number> = new Map();
  private currentUrl: string = window.location.href;
  private calculationTimeout: NodeJS.Timeout | null = null;
  private isCalculating: boolean = false;
  private retryCount: number = 0;
  private maxRetries: number = 5;
  private scrollListener: (() => void) | null = null;
  private isFreeUser: boolean = false;
  private hasCompletedInitialLoad: boolean = false;

  constructor() {
    this.contextIndicator = createContextIndicator('claude');
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

    // Detect model FIRST before any calculations
    this.observeModelChanges();

    // Now use the detected model's limit
    const modelLimit = CLAUDE_MODELS[this.currentModel];
    const maxTokens = typeof modelLimit === 'number' ? modelLimit : 50000;

    // Check if there are any messages first
    const hasMessages = document.querySelector(SELECTORS.userMessage) ||
      document.querySelector('[data-testid^="assistant-"]');

    if (hasMessages) {
      // Show loading state only if there are messages to calculate
      this.contextIndicator.update(0, maxTokens, true);
    } else {
      // New chat - just show 0
      this.contextIndicator.update(0, maxTokens, false);
    }

    // Start observing chat changes
    this.observeChat();

    // Initial calculation with slight delay to ensure DOM is ready
    setTimeout(() => {
      this.calculateContext(true);
    }, 200);

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

    this.currentUrl = newUrl;

    // Clear token cache for new chat
    this.tokenCache.clear();

    // Reset initial load flag for new chat
    this.hasCompletedInitialLoad = false;

    // Disconnect existing observers
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.inputObserver) {
      this.inputObserver.disconnect();
      this.inputObserver = null;
    }

    // Show loading state immediately for chat switches
    const modelLimit = CLAUDE_MODELS[this.currentModel];
    const maxTokens = typeof modelLimit === 'number' ? modelLimit : 50000;

    // For chat switches, show loading state by default
    // We'll determine if it's empty during calculation
    this.contextIndicator.update(0, maxTokens, true);

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
      // Indicator inserted successfully
    } else {
      // Try a direct body insertion as fallback
      document.body.appendChild(this.contextIndicator);
    }
  }

  private observeChat() {
    const chatContainer = this.findElement(SELECTORS.chatContainer);
    if (!chatContainer) {
      // Retry after a delay if chat container not found, but limit retries
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        // Chat container not found, retrying...
        setTimeout(() => this.observeChat(), 1000);
      } else {
        // Max retries reached
      }
      return;
    }

    // Found chat container, setting up observer
    this.observer = new MutationObserver(() => {
      this.scheduleCalculation();
    });

    this.observer.observe(chatContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Removed scroll listener setup - no longer tracking unloaded content

    // Also observe the input field specifically
    this.observeInputField();
  }

  private observeInputField() {
    // Find and observe the ProseMirror input field
    const inputField = this.findElement(SELECTORS.inputField);
    if (!inputField) {
      // Retry after a delay
      setTimeout(() => this.observeInputField(), 1000);
      return;
    }

    // Disconnect existing input observer if any
    if (this.inputObserver) {
      this.inputObserver.disconnect();
    }

    // Create observer for input field changes
    this.inputObserver = new MutationObserver(() => {
      this.scheduleCalculation();
    });

    // Observe with all mutation types to catch ProseMirror changes
    this.inputObserver.observe(inputField, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      characterDataOldValue: true
    });

    // Also listen for input events on the field
    inputField.addEventListener('input', () => {
      this.scheduleCalculation();
    });
  }

  // Removed setupScrollListener - no longer tracking unloaded content

  private observeModelChanges() {
    // First check for free user indicators
    this.detectFreeUser();

    const modelSelector = this.findElement(SELECTORS.modelSelector);
    if (modelSelector) {
      // Extract model from selector
      const modelText = modelSelector.textContent || '';
      this.updateModel(modelText);
    } else {
      // If no model selector visible, still try to determine model
      // Look for model text in the page (e.g., "Sonnet 4" in buttons or elsewhere)
      const modelButton = document.querySelector('button:has(> div > img[alt="Claude"])');
      if (modelButton) {
        const modelText = modelButton.textContent || '';
        this.updateModel(modelText);
      } else {
        // No model selector found, but still call updateModel to handle defaults
        this.updateModel('');
      }
    }
  }

  private detectFreeUser() {
    // Check for paid plan indicators first
    const hasMaxPlan = document.body.textContent?.includes('Max plan') || false;
    const hasProPlan = document.body.textContent?.includes('Pro plan') || false;
    const hasPaidPlan = hasMaxPlan || hasProPlan;

    // Check for free user indicators only if no paid plan detected
    const hasUpgradePrompts = document.body.textContent?.includes('Upgrade to') || false;
    const hasLimitMessages = document.body.textContent?.includes('message limit') || false;
    const hasFreeIndicator = document.querySelector('[data-testid="free-badge"]') !== null;

    // Only mark as free user if no paid plan detected AND free indicators present
    this.isFreeUser = !hasPaidPlan && (hasUpgradePrompts || hasLimitMessages || hasFreeIndicator);

    if (this.isFreeUser) {
      // Detected Claude Free user
      this.currentModel = 'claude-free-web';
    } else if (hasPaidPlan) {
      // Detected Claude paid plan
      // Don't override model here, let model detection handle it
    }
  }

  private updateModel(modelText: string) {
    const text = modelText.toLowerCase();

    // Check for free user first
    this.detectFreeUser();
    if (this.isFreeUser) {
      this.currentModel = 'claude-free-web';
      return;
    }

    // Parse model from text - check for new model names first
    if (text.includes('sonnet 4') || text.includes('sonnet-4')) {
      this.currentModel = 'claude-sonnet-4';
    } else if (text.includes('opus 4.1') || text.includes('opus-4.1')) {
      this.currentModel = 'claude-opus-4.1';
    } else if (text.includes('3.7 sonnet') || text.includes('3.7-sonnet')) {
      this.currentModel = 'claude-3.7-sonnet';
    } else if (text.includes('3.5 sonnet') || text.includes('3.5-sonnet')) {
      this.currentModel = 'claude-3.5-sonnet';
    } else if (text.includes('sonnet')) {
      // Default to latest Sonnet if version not specified
      this.currentModel = 'claude-sonnet-4';
    } else if (!this.isFreeUser) {
      // If paid user but no model detected, default to latest model
      this.currentModel = 'claude-sonnet-4';
    }
    // Model detected
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
      this.calculateContext(false);
    }, 500);
  }

  private async calculateContext(initialLoad: boolean = false) {
    // Prevent multiple simultaneous calculations
    if (this.isCalculating) {
      return;
    }

    try {
      this.isCalculating = true;

      // Get all messages
      const userMessages = document.querySelectorAll(SELECTORS.userMessage);
      let assistantMessages = this.findAllElements(SELECTORS.assistantMessage);

      // If no assistant messages found with main selectors, try alternative detection
      if (assistantMessages.length === 0) {
        // Look for group containers with substantive content
        const allGroups = document.querySelectorAll('div.group');

        assistantMessages = [];
        allGroups.forEach((container) => {
          // Check if this is likely an assistant message
          const paragraphs = container.querySelectorAll('p');
          let hasSubstantiveContent = false;

          // Check if any paragraph has substantial text (not UI elements)
          paragraphs.forEach(p => {
            const text = p.textContent || '';
            // Filter out UI text and short snippets
            if (text.length > 50 &&
              !text.includes('How can I help') &&
              !text.includes('Reply to Claude') &&
              !text.includes('Write your prompt')) {
              hasSubstantiveContent = true;
            }
          });

          if (hasSubstantiveContent) {
            // Check if this is NOT a user message
            // User messages have RS initials as a separate element at the start
            const firstChild = container.firstElementChild;
            const hasUserAvatar = firstChild && firstChild.textContent?.trim() === 'RS';

            // Also check if this container has already been identified as a user message
            const isUserMessage = container.querySelector('[data-testid^="user-"]') !== null;

            // If no user indicators and has substantive content, it's likely assistant
            if (!hasUserAvatar && !isUserMessage) {
              assistantMessages.push(container);
            }
          }
        });
      }

      let totalTokens = 0;

      // Found messages to count

      // Count tokens in user messages
      for (const msg of userMessages) {
        const text = msg.textContent || '';
        const cacheKey = `user-${text.substring(0, 100)}`;

        if (this.tokenCache.has(cacheKey)) {
          totalTokens += this.tokenCache.get(cacheKey)!;
        } else {
          const tokens = await countTokens(text, 'claude');
          this.tokenCache.set(cacheKey, tokens);
          totalTokens += tokens;
          // Counted user message tokens
        }
      }

      // Count tokens in assistant messages
      for (const msg of assistantMessages) {
        const text = msg.textContent || '';
        // Skip button text and metadata
        const cleanText = text.replace(/(Copy|Edit|Retry|Good response|Bad response|Share|Switch model)/g, '').trim();
        const cacheKey = `assistant-${cleanText.substring(0, 100)}`;

        if (this.tokenCache.has(cacheKey)) {
          totalTokens += this.tokenCache.get(cacheKey)!;
        } else {
          const tokens = await countTokens(cleanText, 'claude');
          this.tokenCache.set(cacheKey, tokens);
          totalTokens += tokens;
          // Counted assistant message tokens
        }
      }

      // Get current input
      const inputField = this.findElement(SELECTORS.inputField);
      if (inputField) {
        // Handle ProseMirror editor (Claude uses this)
        let inputText = '';
        if (inputField.classList.contains('ProseMirror')) {
          // ProseMirror stores text in paragraphs
          const paragraphs = inputField.querySelectorAll('p');
          inputText = Array.from(paragraphs).map(p => p.textContent || '').join('\n').trim();
        } else {
          // Fallback to regular text content or value
          inputText = (inputField as HTMLElement).textContent || (inputField as HTMLInputElement).value || '';
        }

        // Filter out placeholder text
        if (inputText &&
          inputText !== 'Reply to Claude...' &&
          inputText !== 'Write your prompt to Claude' &&
          inputText !== 'How can I help you today?') {
          totalTokens += await countTokens(inputText, 'claude');
        }
      }

      // Update indicator with scroll warning if needed
      const modelLimit = CLAUDE_MODELS[this.currentModel];
      const maxTokens = typeof modelLimit === 'number' ? modelLimit : 50000; // Use conservative estimate for variable

      // Check if we have any messages
      const hasMessages = userMessages.length > 0 || assistantMessages.length > 0;

      // For chat switches: if this is the initial calculation and we found no messages,
      // check if this might be a chat that's still loading (not a new empty chat)
      const isNewChat = window.location.pathname === '/new' || window.location.pathname === '/';
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
    } finally {
      this.isCalculating = false;
    }
  }

  public destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.inputObserver) {
      this.inputObserver.disconnect();
    }
    if (this.calculationTimeout) {
      clearTimeout(this.calculationTimeout);
    }
    // Removed scroll listener cleanup
    this.contextIndicator.removeIndicator();
  }
}

// Initialize tracker with singleton pattern
let tracker: ClaudeContextTracker | null = null;

// Initialize when DOM is ready
function initializeTracker() {
  const existingIndicator = document.querySelector('#ai-context-indicator');
  if (!existingIndicator && !tracker) {
    tracker = new ClaudeContextTracker();
  }
}

// Check if we're on Claude.ai
if (window.location.hostname.includes('claude.ai')) {
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
