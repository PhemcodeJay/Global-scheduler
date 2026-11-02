// Gonest International - Appointments Module

async function loadAppointments() {
  const container = document.getElementById('appointmentsContainer');
  const noAppointments = document.getElementById('noAppointments');
  const countEl = document.getElementById('appointmentCount');
  
  container.innerHTML = '<div class="loading-appointments">Loading your appointments...</div>';
  noAppointments.style.display = 'none';
  
  try {
    const response = await fetch('/api/appointments', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    
    if (!response.ok) throw new Error('Failed to fetch appointments');
    
    const appointments = await response.json();
    const confirmedAppointments = appointments.filter(a => a.status === 'confirmed');
    
    if (confirmedAppointments.length === 0) {
      container.innerHTML = '';
      noAppointments.style.display = 'block';
      countEl.textContent = '0 appointments';
      return;
    }
    
    noAppointments.style.display = 'none';
    countEl.textContent = `${confirmedAppointments.length} appointment${confirmedAppointments.length > 1 ? 's' : ''}`;
    
    renderAppointments(confirmedAppointments);
  } catch (error) {
    console.error('Error loading appointments:', error);
    container.innerHTML = '<div class="loading-appointments">Error loading appointments.</div>';
  }
}

function escapeHtml(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

function renderAppointments(appointments) {
  const container = document.getElementById('appointmentsContainer');
  container.innerHTML = '';
  
  appointments.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  appointments.forEach(appointment => {
    const card = document.createElement('div');
    card.className = 'appointment-card';
    
    card.innerHTML = `
      <div class="appointment-info">
        <div class="appointment-service">${escapeHtml(appointment.service_name)}</div>
        <div class="appointment-details">
          <span class="date">📅 ${formatDate(appointment.date)}</span>
          <span>🕐 ${formatTime(appointment.start_time)} - ${formatTime(appointment.end_time)}</span>
          <span>👤 ${escapeHtml(appointment.client_name)}</span>
          <span>📧 ${escapeHtml(appointment.client_email)}</span>
          ${appointment.passport_number ? `<span>🛂 ${escapeHtml(appointment.passport_number)}</span>` : ''}
        </div>
      </div>
      <div class="appointment-actions">
        <button class="btn-cancel" onclick="cancelAppointment(${appointment.id})">Cancel</button>
      </div>
    `;
    
    container.appendChild(card);
  });
}

async function cancelAppointment(appointmentId) {
  if (!confirm('Are you sure you want to cancel this appointment?')) return;
  
  try {
    const response = await fetch(`/api/appointments/${appointmentId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    
    if (response.ok) {
      loadAppointments();
      loadSlots();
      alert('Appointment cancelled successfully');
    } else {
      const data = await response.json();
      alert(data.error || 'Failed to cancel appointment');
    }
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    alert('Failed to cancel appointment');
  }
}

async function submitBooking() {
  const slotId = document.getElementById('bookingSlotId').value;
  const clientName = document.getElementById('bookingName').value.trim();
  const clientEmail = document.getElementById('bookingEmail').value.trim();
  const clientPhone = document.getElementById('bookingPhone').value.trim();
  const notes = document.getElementById('bookingNotes').value.trim();
  const dateOfBirth = document.getElementById('bookingDob').value;
  const gender = document.getElementById('bookingGender').value;
  const nationality = document.getElementById('bookingNationality').value.trim();
  const passportNumber = document.getElementById('bookingPassport').value.trim().toUpperCase();
  const passportExpiry = document.getElementById('bookingPassportExpiry').value;
  
  const errorEl = document.getElementById('bookingError');
  errorEl.style.display = 'none';
  
  if (!clientName || !clientEmail) {
    errorEl.textContent = 'Please fill in your name and email';
    errorEl.style.display = 'block';
    return;
  }
  
  if (!clientEmail.includes('@')) {
    errorEl.textContent = 'Please enter a valid email address';
    errorEl.style.display = 'block';
    return;
  }
  
  const today = new Date().toISOString().split('T')[0];
  
  if (!dateOfBirth) {
    errorEl.textContent = 'Please enter your date of birth';
    errorEl.style.display = 'block';
    return;
  }
  
  if (dateOfBirth > today) {
    errorEl.textContent = 'Date of birth cannot be in the future';
    errorEl.style.display = 'block';
    return;
  }
  
  if (!nationality) {
    errorEl.textContent = 'Please enter your nationality';
    errorEl.style.display = 'block';
    return;
  }
  
  if (!passportNumber) {
    errorEl.textContent = 'Please enter your passport number';
    errorEl.style.display = 'block';
    return;
  }
  
  if (!/^[A-Z0-9]{5,20}$/.test(passportNumber)) {
    errorEl.textContent = 'Passport number must be 5-20 letters or numbers';
    errorEl.style.display = 'block';
    return;
  }
  
  const confirmBtn = document.getElementById('confirmBookingBtn');
  if (confirmBtn && confirmBtn.disabled) return; // prevent double submission
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Booking...';
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    let response;
    try {
      response = await fetch('/api/appointments', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({
        slot_id: slotId,
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        notes: notes,
        date_of_birth: dateOfBirth,
        gender: gender,
        nationality: nationality,
        passport_number: passportNumber,
        passport_expiry: passportExpiry
      })
      });
    } finally {
      clearTimeout(timeout);
    }
    
    const data = await response.json();
    
    if (response.ok) {
      showSuccessBooking(data.appointment);
      loadSlots();
      loadAppointments();
    } else {
      errorEl.textContent = data.error || 'Failed to book appointment';
      errorEl.style.display = 'block';
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      errorEl.textContent = 'Booking is taking longer than 1 second. Please refresh your appointments before trying again.';
    } else {
      errorEl.textContent = 'Network error. Please try again.';
    }
    errorEl.style.display = 'block';
    console.error('Booking error:', error);
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Booking';
    }
  }
}
