// ---------- Appointments Tab ----------
let adminAppointmentSearchTimer = null;
function adminStatusLabel(status) {
  const labels = { confirmed: 'Confirmed', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled' };
  return labels[status] || status;
}
function debounceAdminAppointments() {
  clearTimeout(adminAppointmentSearchTimer);
  adminAppointmentSearchTimer = setTimeout(loadAdminAppointments, 250);
}
function clearAdminAppointmentFilters() {
  document.getElementById('apptStatusFilter').value = '';
  document.getElementById('apptDateFilter').value = '';
  document.getElementById('apptSearchFilter').value = '';
  loadAdminAppointments();
}
async function loadAdminAppointments() {
  const body = document.getElementById('adminAppointmentsBody');
  body.innerHTML = '<tr><td colspan="9" class="loading-text">Loading bookings...</td></tr>';
  try {
    const status = document.getElementById('apptStatusFilter').value;
    const date = document.getElementById('apptDateFilter').value;
    const search = document.getElementById('apptSearchFilter').value.trim();
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (date) query.set('date', date);
    if (search) query.set('search', search);
    const appointments = await apiCall(`/api/admin/appointments${query.size ? `?${query}` : ''}`);
    document.getElementById('appointmentCount').textContent = `${appointments.length} booking${appointments.length === 1 ? '' : 's'}`;
    if (appointments.length === 0) {
      body.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="empty-icon"></div>No booked appointments found</td></tr>';
      return;
    }
    body.innerHTML = appointments.map(a => {
      let actions;
      if (a.status === 'confirmed') {
        actions = `
          <button class="btn-action btn-complete" onclick="adminSetAppointmentStatus(${a.id}, 'completed')">Mark completed</button>
          <button class="btn-action btn-no-show" onclick="adminSetAppointmentStatus(${a.id}, 'no_show')">No-show</button>
          <button class="btn-action btn-delete" onclick="adminSetAppointmentStatus(${a.id}, 'cancelled')">Cancel booking</button>`;
      } else if (a.status === 'cancelled') {
        actions = `<button class="btn-action btn-restore" onclick="adminSetAppointmentStatus(${a.id}, 'confirmed')">Restore booking</button>`;
      } else {
        actions = '<small class="management-complete">Outcome recorded</small>';
      }
      return `
      <tr>
        <td>#${a.id}</td>
        <td><strong>${escapeHtml(a.client_name)}</strong></td>
        <td>${a.passport_number || ''}${a.date_of_birth ? `<br><small>DOB: ${escapeHtml(a.date_of_birth)}</small>` : ''}${a.nationality ? `<br><small>${escapeHtml(a.nationality)}</small>` : ''}</td>
        <td>${escapeHtml(a.client_email)}</td>
        <td><strong>${escapeHtml(a.service_name)}</strong></td>
        <td>${formatDateAdmin(a.date)}</td>
        <td>${formatTimeAdmin(a.start_time)}</td>
        <td><span class="badge ${escapeHtml(a.status)}">${adminStatusLabel(a.status)}</span></td>
        <td class="booking-actions">${actions}</td>
      </tr>`;
    }).join('');
  } catch (error) {
    body.innerHTML = `<tr><td colspan="9" class="loading-text">Failed: ${escapeHtml(error.message)}</td></tr>`;
  }
}
async function adminSetAppointmentStatus(id, status) {
  const confirmations = {
    completed: ['mark this booking completed', 'Booking Updated', 'The appointment was marked completed.'],
    no_show: ['record this booking as a no-show', 'No-show Recorded', 'The appointment was recorded as a no-show.'],
    cancelled: ['cancel this booking and release its slot', 'Booking Cancelled', 'The booking was cancelled and its slot released.'],
    confirmed: ['restore this cancelled booking', 'Booking Restored', 'The booking was restored when the slot had capacity.']
  };
  const [question, title, message] = confirmations[status] || ['update this booking', 'Booking Updated', 'The booking was updated.'];
  if (!confirm(`Are you sure you want to ${question}?`)) return;
  try {
    await apiCall(`/api/admin/appointments/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status })
    });
    showSuccess(title, message);
    await Promise.all([loadAdminAppointments(), loadStats()]);
  } catch (error) {
    alert(error.message);
  }
}
// Gonest International - Admin Panel Module
let adminSlotsCache = [];
function escapeHtml(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}
function formatDateAdmin(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function formatTimeAdmin(timeStr) {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.split(':');
  const h = parseInt(hours);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${minutes} ${ampm}`;
}
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getToken()}`
  };
}
async function apiCall(path, options = {}) {
  const res = await fetch(path, { ...options, headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function logout() {
  if (confirm('Are you sure you want to logout?')) {
    localStorage.removeItem('gonest_token');
    localStorage.removeItem('gonest_user');
    window.location.href = '/';
  }
}
function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => { el.style.display = 'none'; });
  const tabEl = document.getElementById('tab-' + tab);
  if (tabEl) tabEl.style.display = 'block';
  document.querySelectorAll('.admin-tab').forEach(btn =>btn.classList.remove('active'));
  const btn = document.querySelector(`.admin-tab[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');
  if (tab === 'dashboard') loadDashboardTab();
  if (tab === 'slots') loadAdminSlots();
  if (tab === 'appointments') loadAdminAppointments();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'autobook') loadAutoBookTab();
}
function showSuccess(title, message) {
  document.getElementById('successTitle').textContent = title;
  document.getElementById('successMsg').textContent = message;
  document.getElementById('successModal').style.display = 'flex';
}
function closeSuccessModal() {
  document.getElementById('successModal').style.display = 'none';
}
function showErrorMsg(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.style.display = 'block';
}
function hideErrorMsg(elementId) {
  document.getElementById(elementId).style.display = 'none';
}
// ---------- Stats ----------
async function loadStats() {
  try {
    const s = await apiCall('/api/admin/stats');
    document.getElementById('statUsers').textContent = s.totalUsers;
    document.getElementById('statSlots').textContent = s.totalSlots;
    document.getElementById('statAvailable').textContent = s.availableSlots;
    document.getElementById('statAppointments').textContent = s.totalAppointments;
    document.getElementById('statToday').textContent = s.todayAppointments;
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}
// ---------- Dashboard Tab ----------
async function loadDashboardTab() {
  const el = document.getElementById('recentActivity');
  el.innerHTML = '<div class="loading-text">Loading...</div>';
  try {
    const activities = await apiCall('/api/admin/settings/activity?limit=10');
    if (activities.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon"></div>No activity yet</div>';
      return;
    }
    el.innerHTML = activities.map(a => {
      if (a.type === 'booking') {
        return `<div style="padding:10px 0;border-bottom:1px solid #eee">
          <strong> ${escapeHtml(a.service_name)}</strong>  ${escapeHtml(a.user_name)}
          <br><small>${formatDateAdmin(a.date)}  ${formatTimeAdmin(a.start_time)}  <span class="badge ${escapeHtml(a.status)}">${escapeHtml(a.status)}</span></small>
        </div>`;
      }
      return `<div style="padding:10px 0;border-bottom:1px solid #eee">
        <strong>New user:</strong> ${escapeHtml(a.user_name)}
        <br><small>${escapeHtml(a.user_email)}  ${new Date(a.created_at).toLocaleString()}</small>
      </div>`;
    }).join('');
  } catch (error) {
    el.innerHTML = '<div class="loading-text">Failed to load activity</div>';
  }
}
// ---------- Slots Tab ----------
async function loadAdminSlots() {
  const body = document.getElementById('adminSlotsBody');
  body.innerHTML = '<tr><td colspan="7" class="loading-text">Loading slots...</td></tr>';
  try {
    const date = document.getElementById('slotDateFilter').value;
    const status = document.getElementById('slotStatusFilter').value;
    let url = '/api/admin/slots';
    const params = [];
    if (date) params.push(`date=${date}`);
    if (status) params.push(`status=${status}`);
    if (params.length) url += '?' + params.join('&');
    const slots = await apiCall(url);
    adminSlotsCache = slots;
    if (slots.length === 0) {
      body.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="empty-icon"></div>No slots found</td></tr>';
      return;
    }
    body.innerHTML = slots.map(slot => `
      <tr>
        <td><strong>${escapeHtml(slot.service_name)}</strong></td>
        <td>${formatDateAdmin(slot.date)}</td>
        <td>${formatTimeAdmin(slot.start_time)} - ${formatTimeAdmin(slot.end_time)}</td>
        <td>${slot.capacity}</td>
        <td>${slot.booked_count}</td>
        <td><span class="badge ${escapeHtml(slot.status)}">${escapeHtml(slot.status)}</span></td>
        <td>
          <button class="btn-action btn-edit" onclick="editSlot(${slot.id})">Edit</button>
          <button class="btn-action btn-delete" onclick="deleteSlot(${slot.id})">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="loading-text">Failed: ${escapeHtml(error.message)}</td></tr>`;
  }
}
function openAddSlotModal() {
  document.getElementById('addSlotForm').reset();
  document.getElementById('editSlotId').value = '';
  hideErrorMsg('addSlotError');
  document.getElementById('newSlotDate').min = new Date().toISOString().split('T')[0];
  document.getElementById('addSlotModal').style.display = 'flex';
}
function closeAddSlotModal() {
  document.getElementById('addSlotModal').style.display = 'none';
}
function editSlot(id) {
  const slot = adminSlotsCache.find(s =>s.id === id);
  if (!slot) return;
  document.getElementById('editSlotId').value = slot.id;
  document.getElementById('newSlotService').value = slot.service_name;
  document.getElementById('newSlotDesc').value = slot.description || '';
  document.getElementById('newSlotDate').value = slot.date;
  document.getElementById('newSlotStart').value = slot.start_time;
  document.getElementById('newSlotEnd').value = slot.end_time;
  document.getElementById('newSlotCap').value = slot.capacity;
  hideErrorMsg('addSlotError');
  document.getElementById('addSlotModal').style.display = 'flex';
}
async function submitAddSlot() {
  hideErrorMsg('addSlotError');
  const id = document.getElementById('editSlotId').value;
  const payload = {
    service_name: document.getElementById('newSlotService').value.trim(),
    description: document.getElementById('newSlotDesc').value.trim(),
    date: document.getElementById('newSlotDate').value,
    start_time: document.getElementById('newSlotStart').value,
    end_time: document.getElementById('newSlotEnd').value,
    capacity: parseInt(document.getElementById('newSlotCap').value, 10) || 1
  };
  if (!payload.service_name || !payload.date || !payload.start_time || !payload.end_time) {
    showErrorMsg('addSlotError', 'Please fill in all required fields');
    return;
  }
  try {
    if (id) {
      await apiCall(`/api/slots/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showSuccess('Slot Updated', `${payload.service_name} has been updated.`);
    } else {
      await apiCall('/api/slots', { method: 'POST', body: JSON.stringify(payload) });
      showSuccess('Slot Created', `${payload.service_name} added for ${formatDateAdmin(payload.date)}.`);
    }
    closeAddSlotModal();
    loadAdminSlots();
    loadStats();
  } catch (error) {
    showErrorMsg('addSlotError', error.message);
  }
}
async function deleteSlot(id) {
  if (!confirm('Delete this slot? This cannot be undone.')) return;
  try {
    await apiCall(`/api/slots/${id}`, { method: 'DELETE' });
    showSuccess('Slot Deleted', 'The slot has been removed.');
    loadAdminSlots();
    loadStats();
  } catch (error) {
    alert(error.message);
  }
}
// ---------- Users Tab ----------
async function loadAdminUsers() {
  const body = document.getElementById('adminUsersBody');
  body.innerHTML = '<tr><td colspan="6" class="loading-text">Loading users...</td></tr>';
  try {
    const role = document.getElementById('userRoleFilter').value;
    let url = '/api/admin/users';
    if (role) url += `?role=${role}`;
    const users = await apiCall(url);
    document.getElementById('userCount').textContent = `${users.length} total`;
    if (users.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-icon"></div>No users found</td></tr>';
      return;
    }
    const me = getCurrentUser();
    body.innerHTML = users.map(u => `
      <tr>
        <td>#${u.id}</td>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="badge ${u.role}">${u.role}</span></td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td>
          ${u.id === me.id ? '<small>You</small>' : `
            <button class="btn-action btn-edit" onclick="toggleUserRole(${u.id}, '${u.role}')">${u.role === 'admin' ? 'Make User' : 'Make Admin'}</button>
            <button class="btn-action btn-delete" onclick="deleteUser(${u.id})">Delete</button>
          `}
        </td>
      </tr>
    `).join('');
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="loading-text">Failed: ${escapeHtml(error.message)}</td></tr>`;
  }
}
async function toggleUserRole(id, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  if (!confirm(`Change this user's role to "${newRole}"?`)) return;
  try {
    await apiCall(`/api/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role: newRole }) });
    showSuccess('Role Updated', `User is now a ${newRole}.`);
    loadAdminUsers();
  } catch (error) {
    alert(error.message);
  }
}
async function deleteUser(id) {
  if (!confirm('Delete this user? This cannot be undone.')) return;
  try {
    await apiCall(`/api/admin/users/${id}`, { method: 'DELETE' });
    showSuccess('User Deleted', 'The account has been removed.');
    loadAdminUsers();
    loadStats();
  } catch (error) {
    alert(error.message);
  }
}
// ---------- Auto-Book Tab ----------
async function loadAutoBookTab() {
  const body = document.getElementById('autobookUsersBody');
  body.innerHTML = '<tr><td colspan="5" class="loading-text">Loading settings...</td></tr>';
  try {
    const status = await apiCall('/api/auto-book/status');
    const dot = document.getElementById('monitorDot');
    const stats = status.totalBookings
      ? ` | auto-booked ${status.totalBookings} | last ${status.lastBookingMs}ms, avg ${status.avgBookingMs}ms`
      : '';
    document.getElementById('autobookMonitorStatus').textContent = status.message + stats;
    dot.className = 'status-indicator' + (status.monitoring ? ' active' : '');
    const settings = await apiCall('/api/admin/settings');
    if (settings.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state"><div class="empty-icon"></div>No users yet</td></tr>';
      return;
    }
    body.innerHTML = settings.map(s => {
      let prefs = 'All services';
      if (s.preferred_services) {
        try { prefs = JSON.parse(s.preferred_services).join(', ') || 'All services'; } catch (e) {}
      }
      let times = 'Any time';
      if (s.preferred_times) {
        try { times = JSON.parse(s.preferred_times).join(', ') || 'Any time'; } catch (e) {}
      }
      return `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>${escapeHtml(s.email)}</td>
        <td>
          <label class="toggle-switch" style="vertical-align:middle">
            <input type="checkbox" ${s.is_enabled ? 'checked' : ''} onchange="toggleAdminAutoBook(${s.user_id}, this.checked)">
            <span class="toggle-slider"></span>
          </label>
          <span class="badge ${s.is_enabled ? 'available' : 'cancelled'}">${s.is_enabled ? 'ON' : 'OFF'}</span>
        </td>
        <td>${escapeHtml(prefs)}</td>
        <td>${escapeHtml(times)}</td>
      </tr>`;
    }).join('');
  } catch (error) {
    body.innerHTML = `<tr><td colspan="5" class="loading-text">Failed: ${escapeHtml(error.message)}</td></tr>`;
  }
}
async function toggleAdminAutoBook(userId, enabled) {
  try {
    await apiCall(`/api/admin/settings/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ is_enabled: enabled })
    });
    showSuccess('Setting Updated', enabled ? 'Auto-book enabled for user.' : 'Auto-book disabled for user.');
    loadAutoBookTab();
  } catch (error) {
    alert(error.message);
  }
}
// ---------- Initialize ----------
document.addEventListener('DOMContentLoaded', () => {
  if (!isLoggedIn()) {
    window.location.href = '/';
    return;
  }
  fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${getToken()}` } })
    .then(res => {
      if (!res.ok) throw new Error('Unauthorized');
      return res.json();
    })
    .then(user => {
      if (user.role !== 'admin') {
        alert('Admin access required.');
        window.location.href = '/dashboard.html';
        return;
      }
      document.getElementById('adminUserName').textContent = user.name;
      loadStats();
      loadDashboardTab();
      setInterval(loadStats, 15000);
    })
    .catch(() => {
      localStorage.removeItem('gonest_token');
      localStorage.removeItem('gonest_user');
      window.location.href = '/';
    });
});
