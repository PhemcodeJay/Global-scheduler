// Dashboard initialization and auth helpers

function checkAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = '/';
    return false;
  }
  
  // Verify token
  fetch('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  .then(res => {
    if (!res.ok) {
      localStorage.removeItem('gonest_token');
      localStorage.removeItem('gonest_user');
      window.location.href = '/';
    } else {
      initDashboard();
    }
  })
  .catch(() => {
    localStorage.removeItem('gonest_token');
    localStorage.removeItem('gonest_user');
    window.location.href = '/';
  });
  
  return true;
}

function initDashboard() {
  const user = getCurrentUser();
  
  // Update UI
  document.getElementById('userName').textContent = user.name || 'User';
  document.getElementById('welcomeName').textContent = user.name || 'User';
  
  // Check if admin
  if (user.role === 'admin') {
    document.getElementById('adminBadge').style.display = 'block';
  }
  
  // Load user's appointments
  if (typeof loadAppointments === 'function') {
    loadAppointments();
  }
  
  // Check auto-book setting
  checkAutoBookSetting();
  
  // Setup logout
  window.logout = function() {
    if (confirm('Are you sure you want to logout?')) {
      localStorage.removeItem('gonest_token');
      localStorage.removeItem('gonest_user');
      window.location.href = '/';
    }
  };
}

async function checkAutoBookSetting() {
  try {
    const response = await fetch('/api/auto-book/settings', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    
    if (response.ok) {
      const settings = await response.json();
      
      if (settings.is_enabled) {
        document.getElementById('autoBookToggle').checked = true;
        updateAutoBookStatus(true);
      } else {
        updateAutoBookStatus(false);
      }
      
      // Populate per-client booking rules UI
      renderAutoBookPrefs(settings);
    }
  } catch (error) {
    console.error('Failed to check auto-book setting:', error);
  }
}

async function renderAutoBookPrefs(settings) {
  const box = document.getElementById('servicePrefs');
  if (!box) return;
  
  try {
    const res = await fetch('/api/slots/services/list', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const services = res.ok ? await res.json() : [];
    const selected = Array.isArray(settings.preferred_services) ? settings.preferred_services : [];
    
    box.innerHTML = services.length
      ? services.map(s => `
          <label class="checkbox-label">
            <input type="checkbox" class="svc-pref" value="${s.service_name}" ${selected.includes(s.service_name) ? 'checked' : ''}> ${s.service_name}
          </label>
        `).join('')
      : '<small style="color:#999">No services yet</small>';
  } catch (error) {
    box.innerHTML = '<small style="color:#999">Failed to load services</small>';
  }
  
  const times = Array.isArray(settings.preferred_times) ? settings.preferred_times : [];
  document.querySelectorAll('#timePrefs input[type="checkbox"]').forEach(cb => {
    cb.checked = times.includes(cb.value);
  });
  document.getElementById('exactTimePref').value = times.find(time => /^\d{2}:\d{2}$/.test(time)) || '';
}

async function saveAutoBookPrefs() {
  const flash = document.getElementById('prefSaved');
  const saveButton = document.getElementById('savePrefsBtn');
  saveButton.disabled = true;
  const preferred_services = Array.from(document.querySelectorAll('.svc-pref:checked')).map(cb => cb.value);
  const preferred_times = Array.from(document.querySelectorAll('#timePrefs input:checked')).map(cb => cb.value);
  const exactTime = document.getElementById('exactTimePref').value;
  if (exactTime) preferred_times.push(exactTime);
  
  try {
    const res = await fetch('/api/auto-book/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        is_enabled: document.getElementById('autoBookToggle').checked,
        preferred_services,
        preferred_times
      })
    });
    
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Save failed');
    }
    
    flash.style.color = '#080';
    flash.textContent = '✓ Saved';
    setTimeout(() => { flash.textContent = ''; }, 2500);
  } catch (error) {
    flash.style.color = '#c00';
    flash.textContent = `✗ ${error.message}`;
    setTimeout(() => { flash.textContent = ''; }, 3500);
  } finally {
    saveButton.disabled = false;
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});
