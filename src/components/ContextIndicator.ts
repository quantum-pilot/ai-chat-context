export function createContextIndicator(provider: 'claude' | 'chatgpt' = 'claude') {
  const container = document.createElement('div');
  container.id = 'ai-context-indicator';

  // Apply styles
  container.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: white;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    padding: 8px 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    min-width: 120px;
    text-align: center;
  `;

  // Create main display
  const mainDisplay = document.createElement('div');
  mainDisplay.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  // Create token count display
  const tokenDisplay = document.createElement('span');
  tokenDisplay.id = 'token-count';
  tokenDisplay.style.cssText = `
    font-weight: 600;
  `;

  // Create percentage display
  const percentDisplay = document.createElement('span');
  percentDisplay.id = 'token-percent';
  percentDisplay.style.cssText = `
    font-size: 12px;
    opacity: 0.7;
  `;

  // Create tooltip
  const tooltip = document.createElement('div');
  tooltip.id = 'context-tooltip';
  tooltip.style.cssText = `
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: #333;
    color: white;
    padding: 10px;
    border-radius: 6px;
    font-size: 12px;
    min-width: 200px;
    display: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    white-space: pre-line;
  `;

  // Assemble components
  mainDisplay.appendChild(tokenDisplay);
  mainDisplay.appendChild(percentDisplay);
  container.appendChild(mainDisplay);
  container.appendChild(tooltip);

  // Add hover behavior
  container.addEventListener('mouseenter', () => {
    tooltip.style.display = 'block';
  });

  container.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });

  // Update function
  const update = (currentTokens: number, maxTokens: number, hasScrollableContent: boolean = false, isLoading: boolean = false) => {
    // Show loading state
    if (isLoading) {
      tokenDisplay.textContent = 'Loading...';
      percentDisplay.textContent = '';
      tooltip.innerHTML = '<strong>Updating context window...</strong>';
      container.style.backgroundColor = '#f5f5f5';
      container.style.borderColor = '#bdbdbd';
      tokenDisplay.style.color = '#757575';
      container.style.animation = 'pulse 1.5s ease-in-out infinite';
      addPulseAnimation();
      return;
    }

    const percentage = Math.round((currentTokens / maxTokens) * 100);
    const remaining = maxTokens - currentTokens;

    // Update text with warning icon if content is scrollable
    const warningIcon = hasScrollableContent ? '⚠️ ' : '';
    tokenDisplay.textContent = `${warningIcon}${currentTokens.toLocaleString()} / ${maxTokens.toLocaleString()}`;
    percentDisplay.textContent = `(${percentage}%)`;

    // Update tooltip
    const scrollWarning = hasScrollableContent ? '\n\n📜 Note: Scroll to load all messages for accurate count' : '';
    const systemPromptNote = provider === 'chatgpt' 
      ? '\n\n💡 System prompts can add: 2K-5K tokens'
      : '\n\n💡 System prompts can add: 10K-15K tokens';
    tooltip.innerHTML = `
<strong>Context Window Usage</strong>
Current: ${currentTokens.toLocaleString()} tokens
Maximum: ${maxTokens.toLocaleString()} tokens
Remaining: ${remaining.toLocaleString()} tokens
Usage: ${percentage}%
${percentage > 90 ? '\n⚠️ Approaching context limit!' : ''}${scrollWarning}${systemPromptNote}
    `.trim();

    // Update colors based on usage
    let bgColor = '#e8f5e9'; // Green
    let borderColor = '#4caf50';
    let textColor = '#2e7d32';

    if (percentage > 90) {
      // Red - Critical
      bgColor = '#ffebee';
      borderColor = '#f44336';
      textColor = '#c62828';

      // Add flashing animation if over limit
      if (percentage >= 100) {
        container.style.animation = 'flash 1s infinite';
        addFlashAnimation();
      } else {
        container.style.animation = 'none';
      }
    } else if (percentage > 70) {
      // Yellow - Warning
      bgColor = '#fff3e0';
      borderColor = '#ff9800';
      textColor = '#e65100';
      container.style.animation = 'none';
    } else {
      container.style.animation = 'none';
    }

    container.style.backgroundColor = bgColor;
    container.style.borderColor = borderColor;
    tokenDisplay.style.color = textColor;
  };

  // Add flash animation
  const addFlashAnimation = () => {
    if (!document.querySelector('#context-flash-style')) {
      const style = document.createElement('style');
      style.id = 'context-flash-style';
      style.textContent = `
        @keyframes flash {
          0%, 50%, 100% { opacity: 1; }
          25%, 75% { opacity: 0.5; }
        }
      `;
      document.head.appendChild(style);
    }
  };

  // Add pulse animation for loading state
  const addPulseAnimation = () => {
    if (!document.querySelector('#context-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'context-pulse-style';
      style.textContent = `
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `;
      document.head.appendChild(style);
    }
  };

  // Remove function
  const removeIndicator = () => {
    container.parentNode?.removeChild(container);
    const flashStyle = document.querySelector('#context-flash-style');
    if (flashStyle) {
      flashStyle.parentNode?.removeChild(flashStyle);
    }
  };

  // Return interface with custom methods
  // Don't override native DOM methods
  return Object.assign(container, {
    update,
    removeIndicator,
  });
}