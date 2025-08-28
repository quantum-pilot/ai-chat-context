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
  private currentModel: string = 'claude-sonnet-4'; // Default to latest model
  private tokenCache: Map<string, number> = new Map();
  private currentUrl: string = window.location.href;
  private calculationTimeout: NodeJS.Timeout | null = null;
  private isCalculating: boolean = false;
  private retryCount: number = 0;
  private maxRetries: number = 5;
  private scrollListener: (() => void) | null = null;
  private hasScrollableContent: boolean = false;
  private isFreeUser: boolean = false;

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
    
    // Show initial loading state
    const modelLimit = CLAUDE_MODELS[this.currentModel];
    const maxTokens = typeof modelLimit === 'number' ? modelLimit : 50000;
    this.contextIndicator.update(0, maxTokens, false, true); // Show loading state
    
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
    
    // Show loading state immediately
    const modelLimit = CLAUDE_MODELS[this.currentModel];
    const maxTokens = typeof modelLimit === 'number' ? modelLimit : 50000;
    this.contextIndicator.update(0, maxTokens, false, true); // Show loading state
    
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

    // Set up scroll listener
    this.setupScrollListener(chatContainer);
  }

  private setupScrollListener(container: Element) {
    // Remove existing listener if any
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true);
      this.scrollListener = null;
    }

    // Find the scrollable parent (Claude uses overflow-y classes)
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

    const scrollableElement = findScrollableParent(container);
    if (scrollableElement) {
      // Check if content is scrollable
      const checkScrollable = () => {
        this.hasScrollableContent = scrollableElement.scrollHeight > scrollableElement.clientHeight;
        console.log('Scrollable content detected:', this.hasScrollableContent);
      };

      checkScrollable();

      this.scrollListener = () => {
        checkScrollable();
        this.scheduleCalculation();
      };
      
      // Listen for scroll events
      scrollableElement.addEventListener('scroll', this.scrollListener, { passive: true });
      
      // Also check when DOM changes
      setTimeout(() => checkScrollable(), 1000);
    }
  }

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
      console.log('Detected Claude Free user');
      this.currentModel = 'claude-free-web';
    } else if (hasPaidPlan) {
      console.log(`Detected Claude paid plan: ${hasMaxPlan ? 'Max' : 'Pro'}`);
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
    } else if (text.includes('opus')) {
      this.currentModel = 'claude-3-opus';
    } else if (text.includes('sonnet')) {
      // Default to latest Sonnet if version not specified
      this.currentModel = 'claude-sonnet-4';
    } else if (text.includes('haiku')) {
      this.currentModel = 'claude-3-haiku';
    } else if (text.includes('claude-2')) {
      this.currentModel = 'claude-2';
    } else if (!this.isFreeUser) {
      // If paid user but no model detected, default to latest model  
      this.currentModel = 'claude-sonnet-4';
    }
    console.log('Detected model:', this.currentModel);
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
        // Skip button text and metadata
        const cleanText = text.replace(/(Copy|Edit|Retry|Good response|Bad response|Share|Switch model)/g, '').trim();
        const cacheKey = `assistant-${cleanText.substring(0, 100)}`;
        
        if (this.tokenCache.has(cacheKey)) {
          totalTokens += this.tokenCache.get(cacheKey)!;
        } else {
          const tokens = await countTokens(cleanText);
          this.tokenCache.set(cacheKey, tokens);
          totalTokens += tokens;
          console.log(`Assistant message tokens: ${tokens} for text: ${cleanText.substring(0, 50)}...`);
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
      
      // Update indicator with scroll warning if needed
      const modelLimit = CLAUDE_MODELS[this.currentModel];
      const maxTokens = typeof modelLimit === 'number' ? modelLimit : 50000; // Use conservative estimate for variable
      this.contextIndicator.update(totalTokens, maxTokens, this.hasScrollableContent);
      console.log(`Context: ${totalTokens}/${maxTokens} tokens (${this.currentModel})`);
      
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
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true);
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