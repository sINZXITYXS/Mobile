// Global state
let ws = null;
let clientId = null;
let connectedDevices = {};

const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  connectToServer();
  if (window.lucide) lucide.createIcons();
});

// Connect to WebSocket server via pairing code
function connectToServer() {
  const isLocalFile = window.location.protocol === 'file:';
  
  if (isLocalFile) {
    console.log('[Server] Running as local file - no network features');
    return;
  }
  
  // Check if we have a pairing code in the URL
  const urlParams = new URLSearchParams(window.location.search);
  const pairingCode = urlParams.get('code');
  
  if (pairingCode) {
    console.log('[Pairing] Received code from URL: ' + pairingCode);
    hidePairingOverlay();
    validatePairingCodeWithServer(pairingCode);
  } else {
    console.log('[Pairing] No pairing code in URL - waiting for user input');
  }
}

function checkPairingCode() {
  const input = document.getElementById('pairing-code-input');
  const status = document.getElementById('pairing-status');
  
  if (input.value.length === 6) {
    status.textContent = 'Code ready - press Connect';
    status.style.color = '#86efac';
  } else {
    status.textContent = 'Enter 6-digit code';
    status.style.color = '#9ca3af';
  }
}

function submitPairingCode() {
  const code = document.getElementById('pairing-code-input').value;
  if (code.length !== 6) {
    alert('Please enter a 6-digit code');
    return;
  }
  
  hidePairingOverlay();
  validatePairingCodeWithServer(code);
}

function hidePairingOverlay() {
  const overlay = document.getElementById('pairing-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

function validatePairingCodeWithServer(code) {
  // Try to discover server by trying pairing validation on common local IPs
  const commonIPs = ['192.168.1.252', '192.168.1.1', '10.0.0.1', '127.0.0.1', '192.168.0.1'];
  
  attemptCodeValidation(code, commonIPs, 0);
}

function attemptCodeValidation(code, ips, index) {
  if (index >= ips.length) {
    console.log('[Pairing] Could not validate code on any IP');
    showPairingError();
    return;
  }
  
  const ip = ips[index];
  const url = 'http://' + ip + ':3000/api/pairing/validate';
  
  console.log('[Pairing] Trying validation on ' + ip);
  
  const timeoutId = setTimeout(() => {
    console.log('[Pairing] Timeout on ' + ip);
    attemptCodeValidation(code, ips, index + 1);
  }, 2000);
  
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code })
  })
  .then(res => {
    clearTimeout(timeoutId);
    return res.json();
  })
  .then(data => {
    if (data.valid) {
      console.log('[Pairing] Code validated! Server IP: ' + data.serverIP);
      localStorage.setItem('syncify_server_ip', data.serverIP);
      window.SYNCIFY_SERVER_IP = data.serverIP;
      createWebSocketConnection('ws://' + data.serverIP + ':3000');
    } else {
      attemptCodeValidation(code, ips, index + 1);
    }
  })
  .catch(err => {
    clearTimeout(timeoutId);
    console.log('[Pairing] Validation failed on ' + ip);
    attemptCodeValidation(code, ips, index + 1);
  });
}

function attemptConnectionWithStoredIP() {
  let host = window.SYNCIFY_SERVER_IP || window.location.hostname;
  
  const wsUrl = 'ws://' + host + ':3000';
  
  console.log('Connecting to ' + wsUrl);
  createWebSocketConnection(wsUrl);
}

function showPairingError() {
  console.error('[Pairing] Failed to connect - invalid or expired code');
  alert('Failed to connect. Please scan the QR code again or enter the pairing code.');
}

function createWebSocketConnection(wsUrl) {
  ws = new WebSocket(wsUrl);
  
  ws.onopen = function() {
    console.log('Connected to server');
    const deviceId = generatePermanentDeviceId();
    clientId = deviceId;
    
    ws.send(JSON.stringify({
      type: 'identify',
      clientType: 'phone',
      deviceId: deviceId
    }));
  };
  
  ws.onmessage = function(event) {
    const message = JSON.parse(event.data);
    
    if (message.type === 'identified') {
      clientId = message.clientId;
      console.log('Identified as: ' + clientId);
    }
    
    if (message.type === 'device_joined') {
      if (message.deviceId !== clientId) {
        console.log('Device joined:', message.deviceId, message.deviceType);
        connectedDevices[message.deviceId] = {
          id: message.deviceId,
          type: message.deviceType,
          name: message.deviceName
        };
        updateDeviceList();
      }
    }
    
    if (message.type === 'device_left') {
      delete connectedDevices[message.deviceId];
      updateDeviceList();
    }
  };
  
  ws.onerror = function(err) {
    console.error('WebSocket error:', err);
  };
  
  ws.onclose = function() {
    console.log('Disconnected from server');
    setTimeout(connectToServer, 3000);
  };
}

// Generate permanent device ID
function generatePermanentDeviceId() {
  let deviceId = localStorage.getItem('syncify_device_id');
  
  if (!deviceId) {
    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      new Date().getTimezoneOffset(),
      screen.width + 'x' + screen.height,
      navigator.hardwareConcurrency || 'unknown'
    ].join('|');
    
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    deviceId = Math.abs(hash).toString(16).substring(0, 12);
    localStorage.setItem('syncify_device_id', deviceId);
  }
  
  return deviceId;
}

// Phone functions
function sendTextFromPhone() {
  const input = document.getElementById('phone-text-input');
  if (!input || !input.value.trim()) return;
  
  const text = input.value.trim();
  const devices = Object.values(connectedDevices);
  
  if (devices.length === 0) {
    alert('No devices connected');
    return;
  }
  
  const targetDevice = devices[0];
  const message = {
    type: 'text',
    content: text,
    timestamp: new Date().toISOString()
  };
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    message.targetId = targetDevice.id;
    ws.send(JSON.stringify(message));
    console.log('Text sent');
  }
  
  input.value = '';
}

function sendFilesFromPhone() {
  const input = document.getElementById('phone-file-input');
  if (input) input.click();
}

function captureImageFromPhone() {
  const input = document.getElementById('phone-image-input');
  if (input) input.click();
}

// UI functions
function switchTab(tab) {
  const tabs = ['devices', 'history', 'received', 'settings'];
  
  tabs.forEach(function(t) {
    const panel = document.getElementById('panel-' + t);
    const btn = document.getElementById('tab-' + t);
    
    if (!panel || !btn) return;
    
    if (t === tab) {
      panel.classList.remove('hidden');
      btn.classList.add('bg-neutral-800', 'text-neutral-100');
      btn.classList.remove('text-neutral-400');
    } else {
      panel.classList.add('hidden');
      btn.classList.remove('bg-neutral-800', 'text-neutral-100');
      btn.classList.add('text-neutral-400');
    }
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  
  if (sidebar) sidebar.classList.toggle('-translate-x-full');
  if (overlay) overlay.classList.toggle('hidden');
}

// Update device list
function updateDeviceList() {
  const container = document.getElementById('devices-container');
  if (!container) return;
  
  const devices = Object.values(connectedDevices);
  const countEl = document.getElementById('device-count');
  if (countEl) {
    countEl.textContent = devices.length + ' device' + (devices.length !== 1 ? 's' : '') + ' found';
  }
  
  if (devices.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center text-center py-10 border border-dashed border-neutral-800 rounded-xl">
        <div class="w-10 h-10 rounded-xl bg-neutral-900 flex items-center justify-center mb-3 border border-neutral-800">
          <i data-lucide="monitor-smartphone" style="width:18px;height:18px;" stroke-width="1.5" class="text-neutral-500"></i>
        </div>
        <p class="text-sm font-medium text-neutral-400">No devices found</p>
      </div>
    `;
    return;
  }
  
  const deviceIcons = {
    'phone': 'smartphone',
    'tablet': 'tablet',
    'desktop': 'monitor'
  };
  
  const deviceLabels = {
    'phone': 'Phone',
    'tablet': 'Tablet',
    'desktop': 'Desktop'
  };
  
  container.innerHTML = devices.map(device => `
    <div class="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex items-center gap-3">
      <div class="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center">
        <i data-lucide="${deviceIcons[device.type] || 'device'}" style="width:18px;height:18px;" stroke-width="1.5" class="text-neutral-300"></i>
      </div>
      <div>
        <p class="text-sm font-medium text-neutral-100">${device.name || deviceLabels[device.type]}</p>
        <p class="text-xs text-neutral-500">${device.id}</p>
      </div>
    </div>
  `).join('');
  
  if (window.lucide) lucide.createIcons();
}
