// ========================================================================
// CONFIGURATION: Add the text of any elements you want to hide here.
// This is case-sensitive. It will hide any element containing this text.
// ========================================================================
const elementsToHide = [
//  "Hidden",             // This will hide the "Hidden" header itself

];
// ========================================================================

// Function to find and hide specific elements based on the list above
function hideListedElements(root) {
  const container = root.querySelector('div');
  if (!container) return;

  const allElements = Array.from(container.children);
  let hiddenInThisPass = 0;

  // Loop through every element on the page
  for (const element of allElements) {
    // Skip elements that are already hidden to improve efficiency
    if (element.style.display === 'none') {
      continue;
    }

    const elementText = element.textContent;
    if (!elementText) continue;

    // Check if this element's text contains any of the strings from our list
    for (const searchText of elementsToHide) {
      if (elementText.includes(searchText)) {
        element.style.display = 'none';
        hiddenInThisPass++;
        console.log(` -> Hid element matching "${searchText}": <${element.tagName.toLowerCase()} class="${element.className}">`);
        // Break the inner loop and move to the next element once a match is found
        break;
      }
    }
  }

  if (hiddenInThisPass > 0) {
    console.log(`[SUCCESS] Hid ${hiddenInThisPass} new element(s) based on the configuration list.`);
  }
}

// Main function to find the correct Shadow DOM and attach the observer
async function startScript() {
  console.log('Starting list-based persistent hiding script...');

  const waitForShadowRoot = async (selector, parent = document) => {
    return new Promise(resolve => {
      const check = () => {
        const el = parent.querySelector(selector);
        if (el && el.shadowRoot) { resolve(el.shadowRoot); }
        else { setTimeout(check, 100); }
      };
      check();
    });
  };

  const appShadowRoot = await waitForShadowRoot('esp-app');
  const tableShadowRoot = await waitForShadowRoot('esp-entity-table', appShadowRoot);
  console.log('Found the necessary shadow roots.');

  let debounceTimer;

  const observer = new MutationObserver(() => {
    // Debounce to wait for rapid UI updates to finish
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      hideListedElements(tableShadowRoot);
    }, 100); // Increased delay slightly for more stability
  });

  // Run once at the start
  setTimeout(() => hideListedElements(tableShadowRoot), 150);

  // Start observing for future changes
  observer.observe(tableShadowRoot, { childList: true, subtree: true });
  console.log('Persistent observer is now active.');
}

// Run the script
startScript();
