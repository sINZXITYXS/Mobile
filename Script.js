// Global state
let ws = null;
let clientId = null;
let connectedDevices = {};
let peerConnections = {};
let dataChannels = {};

const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ]
};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  // Only connect to server if this is the Phone.html (not desktop)
  // Desktop app is now local-only, no network features
  connectToServer();
  if (window.lucide) lucide.createIcons();
});

// Connect to WebSocket server
function connectToServer() {
  // Only connect if we have a valid server IP (Phone.html on Netlify or Network)
  // Desktop app (local file://) should NOT connect
  const isLocalFile = window.location.protocol === 'file:';
  
  if (isLocalFile) {
    console.log('[Server] Running as local Electron app - no network features');
    return;
  }
  
  // For Phone.html hosted on Netlify, use the stored server IP
  let host = window.SYNCIFY_SERVER_IP || window.location.hostname;
  
  const wsUrl = 'ws://' + host + ':3000';
  
  console.log('Connecting to ' + wsUrl);
  
  // For HTTPS sites connecting to local network, try to get permission first
  if (window.location.protocol === 'https:' && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    console.log('[Server] HTTPS PWA connecting to local network - requesting permission');
    
    // Try Local Network Access API (Chrome 94+)
    if (navigator.requestLocalNetworkAccess) {
      navigator.requestLocalNetworkAccess()
        .then(() => {
          console.log('[Server] Local network access granted');
          createWebSocketConnection(wsUrl);
        })
        .catch(err => {
          console.error('[Server] Local network access denied:', err);
          console.log('[Server] Attempting connection anyway...');
          createWebSocketConnection(wsUrl);
        });
    } else {
      console.log('[Server] Local Network Access API not available, attempting connection');
      createWebSocketConnection(wsUrl);
    }
  } else {
    createWebSocketConnection(wsUrl);
  }
}

function createWebSocketConnection(wsUrl) {
  ws = new WebSocket(wsUrl);
  
  ws.onopen = function() {
    console.log('Connected to server');
    const deviceId = generatePermanentDeviceId();
    clientId = deviceId;
    
    ws.send(JSON.stringify({
      type: 'identify',
      clientType: isMobile ? 'phone' : 'desktop',
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

// Desktop functions
function openFileTransfer() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  
  input.onchange = function(e) {
    const files = e.target.files;
    if (files.length === 0) return;
    
    const devices = Object.values(connectedDevices);
    if (devices.length === 0) {
      alert('No devices connected');
      return;
    }
    
    const targetDevice = devices[0];
    
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = function(event) {
        const message = {
          type: 'file',
          targetId: targetDevice.id,
          data: event.target.result,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          timestamp: new Date().toISOString()
        };
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
          console.log('File sent: ' + file.name);
        }
      };
      
      reader.readAsDataURL(file);
    });
  };
  
  input.click();
}

function openTextTransferDesktop() {
  const devices = Object.values(connectedDevices);
  if (devices.length === 0) {
    alert('No devices connected');
    return;
  }
  
  const text = prompt('Enter text to send:');
  if (!text || !text.trim()) return;
  
  const targetDevice = devices[0];
  const message = {
    type: 'text',
    targetId: targetDevice.id,
    content: text,
    timestamp: new Date().toISOString()
  };
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    console.log('Text sent');
  }
}

// QR Code functions
function openQRModal() {
  const modal = document.getElementById('qr-modal');
  if (modal) {
    modal.classList.remove('hidden');
    setTimeout(function() {
      modal.classList.remove('opacity-0');
      modal.classList.add('opacity-100');
    }, 10);
    generateQRCode();
  }
}

function closeQRModal() {
  const modal = document.getElementById('qr-modal');
  if (modal) {
    modal.classList.add('opacity-0');
    modal.classList.remove('opacity-100');
    setTimeout(function() {
      modal.classList.add('hidden');
    }, 300);
  }
}

function generateQRCode() {
  const container = document.getElementById('qr-code-container');
  if (!container) return;
  
  // Point directly to /phone.html for mobile access
  const webUrl = window.location.origin + '/phone.html';
  
  // Add query param with server IP for Netlify-hosted PWA
  const urlWithIP = webUrl + '?server=' + window.location.hostname;
  
  try {
    const img = document.createElement('img');
    img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(urlWithIP);
    img.style.width = '100%';
    img.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(img);
  } catch (err) {
    console.error('Error:', err);
    if (container) container.innerHTML = '<p style="color: red;">Failed to generate QR code</p>';
  }
}

function copyPairingCode() {
  const webUrl = window.location.origin + '/phone.html';
  
  if (navigator.clipboard) {
    navigator.clipboard.writeText(webUrl).then(function() {
      alert('Pairing code copied');
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  } else {
    alert(webUrl);
  }
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

// Update device list on desktop
function updateDeviceList() {
  const container = document.getElementById('devices-container');
  console.log('updateDeviceList called - container:', container);
  
  if (!container) {
    console.error('devices-container not found');
    return;
  }
  
  const devices = Object.values(connectedDevices);
  console.log('Devices to display:', devices);
  
  // Update device count
  const countEl = document.getElementById('device-count');
  if (countEl) {
    countEl.textContent = devices.length + ' device' + (devices.length !== 1 ? 's' : '') + ' found';
  }
  
  if (devices.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center text-center py-10 border border-dashed border-neutral-800 rounded-xl mb-8 transition-all duration-300 hover:border-neutral-700">
        <div class="w-10 h-10 rounded-xl bg-neutral-900 flex items-center justify-center mb-3 border border-neutral-800">
          <i data-lucide="monitor-smartphone" style="width:18px;height:18px;" stroke-width="1.5" class="text-neutral-500"></i>
        </div>
        <p class="text-sm font-medium text-neutral-400">No devices found nearby</p>
        <p class="text-xs text-neutral-600 mt-1">Devices on your network will appear here</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
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
    <div class="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex items-center justify-between hover:border-neutral-700 transition-all duration-300 mb-2">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center">
          <i data-lucide="${deviceIcons[device.type] || 'device'}" style="width:18px;height:18px;" stroke-width="1.5" class="text-neutral-300"></i>
        </div>
        <div>
          <p class="text-sm font-medium text-neutral-100">${device.name || deviceLabels[device.type]}</p>
          <p class="text-xs text-neutral-500">${device.id}</p>
        </div>
      </div>
      <button onclick="disconnectDevice('${device.id}')" class="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-red-900/20 text-red-400 hover:text-red-300 text-xs font-medium transition-colors">
        Disconnect
      </button>
    </div>
  `).join('');
  
  console.log('Device list updated with ' + devices.length + ' devices');
  if (window.lucide) lucide.createIcons();
}

function disconnectDevice(deviceId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'disconnect_device',
      deviceId: deviceId
    }));
  }
  delete connectedDevices[deviceId];
  updateDeviceList();
}
