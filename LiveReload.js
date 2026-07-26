// Live Reload Script - watches for file changes and reloads CSS/JS without full page reload
(function() {
  'use strict';

  // Don't run live reload on file:// protocol (Electron local files)
  if (window.location.protocol === 'file:') {
    console.log('[LiveReload] Disabled for local Electron app');
    return;
  }

  const CHECK_INTERVAL = 500; // Check every 500ms
  const resourceCache = {};
  let lastCheckTime = Date.now();

  // Initialize cache of all resources
  function initResourceCache() {
    // Cache HTML
    resourceCache['index.html'] = { url: '/index.html', hash: null, type: 'html' };
    resourceCache['phone.html'] = { url: '/phone.html', hash: null, type: 'html' };
    
    // Cache CSS
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      if (link.href.includes('/')) {
        const filename = link.href.split('/').pop();
        resourceCache[filename] = { url: link.href, hash: null, type: 'css', element: link };
      }
    });
    
    // Cache JS
    document.querySelectorAll('script[src]').forEach(script => {
      if (script.src.includes('/') && !script.src.includes('cdn') && !script.src.includes('unpkg')) {
        const filename = script.src.split('/').pop();
        resourceCache[filename] = { url: script.src, hash: null, type: 'js', element: script };
      }
    });

    // Get initial hashes
    Object.keys(resourceCache).forEach(key => {
      getResourceHash(key);
    });
  }

  // Get file hash via HEAD request
  function getResourceHash(filename) {
    const resource = resourceCache[filename];
    if (!resource) return;

    fetch(resource.url + '?t=' + Date.now(), { method: 'HEAD' })
      .then(response => {
        const etag = response.headers.get('etag');
        const lastModified = response.headers.get('last-modified');
        const newHash = etag || lastModified || 'unknown';
        
        if (resource.hash && resource.hash !== newHash) {
          console.log('[LiveReload] Detected change in: ' + filename);
          reloadResource(resource);
        }
        
        resource.hash = newHash;
      })
      .catch(err => {
        // Silently ignore errors
      });
  }

  // Reload a specific resource
  function reloadResource(resource) {
    console.log('[LiveReload] Reloading ' + resource.type + ': ' + resource.url);

    if (resource.type === 'css') {
      // Remove old stylesheet
      if (resource.element && resource.element.parentNode) {
        resource.element.parentNode.removeChild(resource.element);
      }
      
      // Create and inject new stylesheet
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = resource.url + '?t=' + Date.now();
      document.head.appendChild(link);
      resource.element = link;
      console.log('[LiveReload] CSS updated: ' + resource.url);
    } 
    else if (resource.type === 'js') {
      // For Script.js, reload and reinitialize
      if (resource.url.includes('Script.js')) {
        fetch(resource.url + '?t=' + Date.now())
          .then(response => response.text())
          .then(text => {
            // Execute the new script in current context
            try {
              eval(text);
              console.log('[LiveReload] Script updated: ' + resource.url);
            } catch (err) {
              console.error('[LiveReload] Error executing new script:', err);
            }
          })
          .catch(err => {
            console.error('[LiveReload] Error loading script:', err);
          });
      } else {
        // For other scripts, full reload
        window.location.reload();
      }
    }
    else if (resource.type === 'html') {
      // For HTML changes, full page reload
      window.location.reload();
    }
  }

  // Check all resources periodically
  function startWatcher() {
    setInterval(() => {
      Object.keys(resourceCache).forEach(filename => {
        getResourceHash(filename);
      });
    }, CHECK_INTERVAL);
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initResourceCache();
      startWatcher();
      console.log('[LiveReload] Active - watching for changes...');
    });
  } else {
    initResourceCache();
    startWatcher();
    console.log('[LiveReload] Active - watching for changes...');
  }
})();
