/**
 * Progress Bar Component
 *
 * Displays a progress bar at the top of the Foundry client for
 * long-running operations like GM Prep and Embedding generation.
 */

const MODULE_ID = 'loremaster';

/**
 * ProgressBar class manages a global progress indicator.
 */
export class ProgressBar {
  /**
   * Create a new ProgressBar instance.
   */
  constructor() {
    this.element = null;
    this.currentOperation = null;
    this.hideTimeout = null;
  }

  /**
   * Initialize the progress bar element in the DOM.
   * Should be called once Foundry is ready.
   */
  initialize() {
    // Create the progress bar container
    this.element = document.createElement('div');
    this.element.id = 'loremaster-progress-bar';
    this.element.className = 'loremaster-progress-container hidden';
    this.element.innerHTML = `
      <div class="loremaster-progress-content">
        <div class="loremaster-progress-icon">
          <i class="fas fa-brain"></i>
        </div>
        <div class="loremaster-progress-info">
          <div class="loremaster-progress-label">Processing...</div>
          <div class="loremaster-progress-track">
            <div class="loremaster-progress-fill"></div>
          </div>
        </div>
        <div class="loremaster-progress-percent">0%</div>
      </div>
    `;

    // Insert at the top of the body
    document.body.insertBefore(this.element, document.body.firstChild);

    console.log(`${MODULE_ID} | Progress bar initialized`);
  }

  /**
   * Show the progress bar with an operation.
   *
   * @param {string} operation - Operation identifier ('gm-prep', 'embeddings', etc.).
   * @param {string} label - Display label for the operation.
   * @param {string} icon - FontAwesome icon class (e.g., 'fa-brain', 'fa-scroll').
   */
  show(operation, label, icon = 'fa-brain') {
    if (!this.element) return;

    // Clear any pending hide
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    this.currentOperation = operation;

    // Update content
    const iconEl = this.element.querySelector('.loremaster-progress-icon i');
    const labelEl = this.element.querySelector('.loremaster-progress-label');
    const fillEl = this.element.querySelector('.loremaster-progress-fill');
    const percentEl = this.element.querySelector('.loremaster-progress-percent');

    if (iconEl) iconEl.className = `fas ${icon}`;
    if (labelEl) labelEl.textContent = label;
    if (fillEl) fillEl.style.width = '0%';
    if (percentEl) percentEl.textContent = '0%';

    // Show the bar
    this.element.classList.remove('hidden');
    this.element.classList.add('visible');
  }

  /**
   * Update the progress bar.
   *
   * @param {string} operation - Operation identifier (must match current).
   * @param {number} progress - Progress percentage (0-100).
   * @param {string} message - Optional message to display.
   */
  update(operation, progress, message = null) {
    if (!this.element || this.currentOperation !== operation) return;

    const fillEl = this.element.querySelector('.loremaster-progress-fill');
    const percentEl = this.element.querySelector('.loremaster-progress-percent');
    const labelEl = this.element.querySelector('.loremaster-progress-label');

    if (fillEl) fillEl.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    if (percentEl) percentEl.textContent = `${Math.round(progress)}%`;
    if (message && labelEl) labelEl.textContent = message;
  }

  /**
   * Complete the progress bar (shows 100% briefly then hides).
   *
   * @param {string} operation - Operation identifier.
   * @param {string} message - Completion message (optional).
   */
  complete(operation, message = null) {
    if (!this.element || this.currentOperation !== operation) return;

    // Show 100%
    this.update(operation, 100, message || 'Complete!');

    // Add success state
    this.element.classList.add('success');

    // Hide after a delay
    this.hideTimeout = setTimeout(() => {
      this.hide(operation);
    }, 2000);
  }

  /**
   * Show an error state.
   *
   * @param {string} operation - Operation identifier.
   * @param {string} message - Error message.
   */
  error(operation, message = null) {
    if (!this.element || this.currentOperation !== operation) return;

    const labelEl = this.element.querySelector('.loremaster-progress-label');
    if (labelEl) labelEl.textContent = message || 'Error occurred';

    // Add error state
    this.element.classList.add('error');

    // Hide after a delay
    this.hideTimeout = setTimeout(() => {
      this.hide(operation);
    }, 3000);
  }

  /**
   * Hide the progress bar.
   *
   * @param {string} operation - Operation identifier (optional, hides if matches or null).
   */
  hide(operation = null) {
    if (!this.element) return;
    if (operation && this.currentOperation !== operation) return;

    this.element.classList.remove('visible', 'success', 'error');
    this.element.classList.add('hidden');
    this.currentOperation = null;

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /**
   * Check if an operation is currently active.
   *
   * @param {string} operation - Operation to check.
   * @returns {boolean} True if this operation is active.
   */
  isActive(operation) {
    return this.currentOperation === operation;
  }
}

// Export singleton instance
export const progressBar = new ProgressBar();
