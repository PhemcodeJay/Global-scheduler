// Gonest International - Slots Module

let currentSlots = [];
let currentServices = [];

const SERVICE_ICONS = {
  'Business Consultation': '💼',
  'Visa Processing Help': '🛂',
  'Immigration Advisory': '🌍',
  'Document Verification': '📄',
  'Passport Services': '🛂'
};

function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function formatTime(timeStr) {
  const [hours, minutes] = timeStr.split(':');
  const h = parseInt(hours);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

function getCurrentUser() {
  return JSON.parse(localStorage.getItem('gonest_user') || '{}');
}

async function loadServices() {
  try {
    const response = await fetch('/api/slots/services/list', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (response.ok) {
      currentServices = await response.json();
      populateServiceFilter();
    }
  } catch (error) {
    console.error('Failed to load services:', error);
  }
}

function populateServiceFilter() {
  const select = document.getElementById('serviceFilter');
  select.innerHTML = '<option value="">All Services</option>';
  currentServices.forEach(service => {
    const option = document.createElement('option');
    option.value = service.service_name;
    option.textContent = service.service_name;
    select.appendChild(option);
  });
}

async function loadSlots(dateFilter = null, serviceFilter = null) {
  const container = document.getElementById('slotsContainer');
  const noSlots = document.getElementById('noSlots');
  
  container.innerHTML = '<div class="loading-slots">Loading available slots...</div>';
  noSlots.style.display = 'none';
  
  try {
    let url = '/api/slots?';
    const params = [];
    if (dateFilter) params.push(`date=${dateFilter}`);
    if (serviceFilter) params.push(`service=${encodeURIComponent(serviceFilter)}`);
    if (params.length > 0) url += params.join('&');
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (!response.ok) throw new Error('Failed to fetch slots');
    
    currentSlots = await response.json();
    
    if (currentSlots.length === 0) {
      container.innerHTML = '';
      noSlots.style.display = 'block';
      return;
    }
    
    noSlots.style.display = 'none';
    renderSlots(currentSlots);
  } catch (error) {
    console.error('Error loading slots:', error);
    container.innerHTML = '<div class="loading-slots">Error loading slots.</div>';
  }
}

function renderSlots(slots) {
  const container = document.getElementById('slotsContainer');
  container.innerHTML = '';
  
  slots.forEach(slot => {
    const card = document.createElement('div');
    card.className = `slot-card ${slot.booked_count >= slot.capacity ? 'booked' : ''}`;
    
    const icon = SERVICE_ICONS[slot.service_name] || '📅';
    const availableSpots = slot.capacity - slot.booked_count;
    const isAvailable = availableSpots > 0 && slot.status === 'available';
    
    card.innerHTML = `
      <div class="slot-service">
        <span class="slot-service-icon">${icon}</span>
        ${slot.service_name}
      </div>
      <div class="slot-date">${formatDate(slot.date)}</div>
      <div class="slot-time">🕐 ${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}</div>
      <div class="slot-availability ${availableSpots <= 1 ? 'low' : ''}">
        ${availableSpots > 0 ? `${availableSpots} spot${availableSpots > 1 ? 's' : ''} available` : 'Fully booked'}
      </div>
      <button class="slot-book-btn" ${!isAvailable ? 'disabled' : ''} onclick="openBookingModal(${slot.id})">
        ${isAvailable ? '📝 Book Now' : 'Unavailable'}
      </button>
    `;
    container.appendChild(card);
  });
}
function openBookingModal(slotId) {
  const slot = currentSlots.find(s => s.id === slotId);
  if (!slot || slot.booked_count >= slot.capacity) return;
  
  // Always start from a pristine form (like the admin modal does)
  const user = getCurrentUser();
  document.getElementById('bookingSlotId').value = slot.id;
  document.getElementById('bookingName').value = user.name || '';
  document.getElementById('bookingEmail').value = user.email || '';
  document.getElementById('bookingPhone').value = '';
  document.getElementById('bookingNotes').value = '';
  document.getElementById('bookingDob').value = '';
  document.getElementById('bookingDob').max = new Date().toISOString().split('T')[0];
  document.getElementById('bookingGender').value = '';
  document.getElementById('bookingPassport').value = '';
  document.getElementById('bookingPassportExpiry').value = '';
  document.getElementById('bookingNationality').value = '';
  document.getElementById('bookingError').style.display = 'none';
  document.getElementById('bookingModal').querySelector('.modal-header h3').textContent = 'Book Appointment';
  
  const confirmBtn = document.getElementById('confirmBookingBtn');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm Booking';
  }
  
  const modalInfo = document.getElementById('modalSlotInfo');
  modalInfo.innerHTML = `
    <div class="slot-info-row">
      <span class="slot-info-label">Service:</span>
      <span class="slot-info-value">${slot.service_name}</span>
    </div>
    <div class="slot-info-row">
      <span class="slot-info-label">Date:</span>
      <span class="slot-info-value">${formatDate(slot.date)}</span>
    </div>
    <div class="slot-info-row">
      <span class="slot-info-label">Time:</span>
      <span class="slot-info-value">${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}</span>
    </div>
  `;
  
  document.getElementById('bookingError').style.display = 'none';
  document.getElementById('bookingModal').style.display = 'flex';
}

function closeBookingModal() {
  document.getElementById('bookingModal').style.display = 'none';
}

function showSuccessBooking(appointment) {
  // Close the booking form modal but never mutate it, so the form
  // is still intact the next time the user clicks "Book Now" (like admin).
  closeBookingModal();
  
  const successMsg = document.getElementById('successMsg');
  if (appointment) {
    successMsg.innerHTML = `
      <p>Your appointment has been confirmed.</p>
      <p style="margin-top:8px"><strong>${appointment.service_name}</strong></p>
      <p>${formatDate(appointment.date)} · ${formatTime(appointment.start_time)} - ${formatTime(appointment.end_time)}</p>
    `;
  } else {
    successMsg.innerHTML = '<p>Your appointment has been confirmed.</p>';
  }
  document.getElementById('successModal').style.display = 'flex';
  
  const lastBooking = document.getElementById('lastBooking');
  if (lastBooking) {
    lastBooking.style.display = 'block';
    document.getElementById('lastBookingTime').textContent = new Date().toLocaleString();
  }
}

function closeSuccessModal() {
  document.getElementById('successModal').style.display = 'none';
}

function updateAutoBookStatus(enabled) {
  document.getElementById('toggleStatus').textContent = enabled ? 'Enabled' : 'Disabled';
  document.getElementById('monitorStatus').style.display = 'flex';
  document.getElementById('statusText').textContent = enabled
    ? 'Server monitor active — checking for matching slots every second.'
    : 'Auto-book disabled';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadServices();
  
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('dateFilter').min = today;
  document.getElementById('dateFilter').value = today;
  
  loadSlots();
  
  const autoBookToggle = document.getElementById('autoBookToggle');
  autoBookToggle.addEventListener('change', async () => {
    const enabled = autoBookToggle.checked;
    autoBookToggle.disabled = true;

    try {
      const response = await fetch('/api/auto-book/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ is_enabled: enabled })
      });
      if (!response.ok) throw new Error('Unable to save auto-book setting');
      updateAutoBookStatus(enabled);
    } catch (error) {
      autoBookToggle.checked = !enabled;
      updateAutoBookStatus(!enabled);
      console.error('Failed to save auto-book setting:', error);
    } finally {
      autoBookToggle.disabled = false;
    }
  });
  
  document.getElementById('filterSlotsBtn').addEventListener('click', () => {
    const dateFilter = document.getElementById('dateFilter').value;
    const serviceFilter = document.getElementById('serviceFilter').value;
    loadSlots(dateFilter, serviceFilter);
  });
});

