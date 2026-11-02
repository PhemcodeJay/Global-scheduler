// Gonest International - Authentication Module
const API_BASE = '/api';
// Show/hide forms
function showLogin() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
}
function showRegister() {
  document.getElementById('registerForm').style.display = 'block';
  document.getElementById('loginForm').style.display = 'none';
}
// Show error message
function showError(elementId, message) {
  const errorEl = document.getElementById(elementId);
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}
function hideError(elementId) {
  document.getElementById(elementId).style.display = 'none';
}
// Show loading state
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  if (loading) {
    btn.disabled = true;
    text.style.display = 'none';
    loader.style.display = 'inline';
  } else {
    btn.disabled = false;
    text.style.display = 'inline';
    loader.style.display = 'none';
  }
}
// Get auth token from localStorage
function getToken() {
  return localStorage.getItem('gonest_token');
}
// Check if user is logged in
function isLoggedIn() {
  return !!getToken();
}
// Redirect to correct page if logged in (auth pages only)
function checkAuthAndRedirect() {
  const token = getToken();
  if (token) {
    // Verify token is still valid
    fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (res.ok) {
        return res.json().then(user => {
          window.location.href = user.role === 'admin' ? '/admin.html' : '/dashboard.html';
        });
      } else {
        localStorage.removeItem('gonest_token');
        localStorage.removeItem('gonest_user');
      }
    })
    .catch(() => {
      localStorage.removeItem('gonest_token');
      localStorage.removeItem('gonest_user');
    });
  }
}
// Handle login
async function handleLogin(e) {
  e.preventDefault();
  hideError('loginError');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) {
    showError('loginError', 'Please fill in all fields');
    return;
  }
  setLoading('loginBtn', true);
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (response.ok) {
      // Store token and user info
      localStorage.setItem('gonest_token', data.token);
      localStorage.setItem('gonest_user', JSON.stringify(data.user));
      // Redirect to dashboard
      window.location.href = data.user.role === 'admin' ? '/admin.html' : '/dashboard.html';
    } else {
      showError('loginError', data.error || 'Login failed');
    }
  } catch (error) {
    showError('loginError', 'Network error. Please try again.');
    console.error('Login error:', error);
  } finally {
    setLoading('loginBtn', false);
  }
}
// Handle registration
async function handleRegister(e) {
  e.preventDefault();
  hideError('registerError');
  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const agreeTerms = document.getElementById('agreeTerms').checked;
  // Validation
  if (!name || !email || !password) {
    showError('registerError', 'Please fill in all fields');
    return;
  }
  if (password.length < 8) {
    showError('registerError', 'Password must be at least 8 characters');
    return;
  }
  if (password !== confirmPassword) {
    showError('registerError', 'Passwords do not match');
    return;
  }
  if (!agreeTerms) {
    showError('registerError', 'You must agree to the terms and conditions');
    return;
  }
  setLoading('registerBtn', true);
  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await response.json();
    if (response.ok) {
      // Store token and user info
      localStorage.setItem('gonest_token', data.token);
      localStorage.setItem('gonest_user', JSON.stringify(data.user));
      // Show success and redirect
      const successEl = document.getElementById('registerError');
      successEl.textContent = ' Registration successful! Redirecting...';
      successEl.className = 'success-message';
      successEl.style.display = 'block';
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 1500);
    } else {
      showError('registerError', data.error || 'Registration failed');
    }
  } catch (error) {
    showError('registerError', 'Network error. Please try again.');
    console.error('Registration error:', error);
  } finally {
    setLoading('registerBtn', false);
  }
}
// Event listeners (auth pages only - index/register)
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  const isAuthPage = path === '/' || path === '/index.html' || path === '/register.html';
  if (!isAuthPage) return;
  // Check auth on load
  checkAuthAndRedirect();
  // Form submissions (only if forms exist)
  const loginForm = document.getElementById('loginFormElement');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);
  const registerForm = document.getElementById('registerFormElement');
  if (registerForm) registerForm.addEventListener('submit', handleRegister);
  // Clear errors on input
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      hideError('loginError');
      hideError('registerError');
    });
  });
});
// Shared helper for other pages
function getCurrentUser() {
  return JSON.parse(localStorage.getItem('gonest_user') || '{}');
}
