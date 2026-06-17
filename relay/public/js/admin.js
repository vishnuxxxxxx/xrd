// RELAY admin console behaviour
(function () {
  'use strict';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* no body */ }
    return { ok: res.ok, status: res.status, data };
  }

  const loginScreen = document.getElementById('login-screen');
  const consoleShell = document.getElementById('console-shell');

  function showLogin() {
    loginScreen.classList.remove('hidden');
    consoleShell.classList.remove('visible');
  }

  function showConsole() {
    loginScreen.classList.add('hidden');
    consoleShell.classList.add('visible');
    loadRoster();
    loadReports();
    loadRecruits();
  }

  // ---- Session check on load ----
  async function checkSession() {
    const { data } = await api('/api/admin/session');
    if (data.authenticated) showConsole();
    else showLogin();
  }

  // ---- Login ----
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorBox = document.getElementById('login-error');
    errorBox.classList.remove('visible');

    const { ok, data } = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (ok) {
      showConsole();
    } else {
      errorBox.textContent = data.error || 'Login failed.';
      errorBox.classList.add('visible');
    }
  });

  // ---- Logout ----
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' });
    showLogin();
  });

  // ---- Nav switching ----
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    });
  });

  // ---- Roster ----
  async function loadRoster() {
    const container = document.getElementById('roster-rows');
    const { ok, data } = await api('/api/admin/members');
    if (!ok) {
      container.innerHTML = '<div class="empty-state">Could not load the roster.</div>';
      return;
    }
    const members = data.members || [];
    document.getElementById('badge-roster').textContent = members.length;

    if (!members.length) {
      container.innerHTML = '<div class="empty-state">No members yet — add one below.</div>';
      return;
    }

    container.innerHTML = members.map((m) => `
      <div class="admin-row" data-id="${escapeHtml(m.id)}">
        <div class="roster-id">${escapeHtml(m.memberId)}</div>
        <div><input type="text" class="field-name" value="${escapeHtml(m.name)}" /></div>
        <div><input type="text" class="field-role" value="${escapeHtml(m.role)}" /></div>
        <div>
          <button type="button" class="toggle ${m.status === 'Active' ? 'on' : ''}" data-status="${escapeHtml(m.status)}" title="Toggle Active / Offline"></button>
        </div>
        <div class="row-actions">
          <button type="button" class="icon-btn btn-delete">Remove</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.admin-row').forEach((row) => {
      const id = row.dataset.id;
      const nameInput = row.querySelector('.field-name');
      const roleInput = row.querySelector('.field-role');
      const toggle = row.querySelector('.toggle');
      const deleteBtn = row.querySelector('.btn-delete');

      async function saveField(payload) {
        await api(`/api/admin/members/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      }

      nameInput.addEventListener('blur', () => {
        if (nameInput.value.trim()) saveField({ name: nameInput.value.trim() });
      });
      roleInput.addEventListener('blur', () => {
        if (roleInput.value.trim()) saveField({ role: roleInput.value.trim() });
      });

      toggle.addEventListener('click', async () => {
        const newStatus = toggle.dataset.status === 'Active' ? 'Offline' : 'Active';
        toggle.classList.toggle('on');
        toggle.dataset.status = newStatus;
        await saveField({ status: newStatus });
      });

      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Remove ${nameInput.value} from the roster?`)) return;
        const { ok: delOk } = await api(`/api/admin/members/${id}`, { method: 'DELETE' });
        if (delOk) row.remove();
      });
    });
  }

  document.getElementById('add-member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('new-member-name');
    const roleInput = document.getElementById('new-member-role');
    const { ok } = await api('/api/admin/members', {
      method: 'POST',
      body: JSON.stringify({ name: nameInput.value.trim(), role: roleInput.value.trim(), status: 'Active' }),
    });
    if (ok) {
      nameInput.value = '';
      roleInput.value = '';
      loadRoster();
    }
  });

  // ---- Reports ----
  function formatDate(iso) {
    try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
  }

  async function loadReports() {
    const container = document.getElementById('reports-list');
    const { ok, data } = await api('/api/admin/reports');
    if (!ok) {
      container.innerHTML = '<div class="empty-state">Could not load reports.</div>';
      return;
    }
    const reports = data.reports || [];
    document.getElementById('badge-reports').textContent = reports.length;

    if (!reports.length) {
      container.innerHTML = '<div class="empty-state">No reports yet.</div>';
      return;
    }

    container.innerHTML = reports.map((r) => `
      <div class="entry-card" data-id="${escapeHtml(r.id)}">
        <div class="entry-head">
          <div>
            <h3>${escapeHtml(r.name)}</h3>
            <div class="entry-meta">${formatDate(r.submittedAt)} ${r.contact ? '· ' + escapeHtml(r.contact) : ''}</div>
          </div>
          <div class="entry-actions">
            <select class="status-select">
              <option ${r.status === 'Open' ? 'selected' : ''}>Open</option>
              <option ${r.status === 'In progress' ? 'selected' : ''}>In progress</option>
              <option ${r.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
            </select>
          </div>
        </div>
        <div class="entry-tags">
          <span class="tag-chip">${escapeHtml(r.category)}</span>
          <span class="tag-chip">${escapeHtml(r.urgency)} urgency</span>
        </div>
        <div class="entry-body">${escapeHtml(r.description)}</div>
      </div>
    `).join('');

    container.querySelectorAll('.entry-card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('.status-select').addEventListener('change', async (e) => {
        await api(`/api/admin/reports/${id}`, { method: 'PUT', body: JSON.stringify({ status: e.target.value }) });
      });
    });
  }

  // ---- Recruitment ----
  async function loadRecruits() {
    const container = document.getElementById('recruits-list');
    const { ok, data } = await api('/api/admin/recruits');
    if (!ok) {
      container.innerHTML = '<div class="empty-state">Could not load applications.</div>';
      return;
    }
    const recruits = data.recruits || [];
    document.getElementById('badge-recruits').textContent = recruits.length;

    if (!recruits.length) {
      container.innerHTML = '<div class="empty-state">No applications yet.</div>';
      return;
    }

    container.innerHTML = recruits.map((r) => `
      <div class="entry-card" data-id="${escapeHtml(r.id)}">
        <div class="entry-head">
          <div>
            <h3>${escapeHtml(r.name)}</h3>
            <div class="entry-meta">${formatDate(r.submittedAt)} · ${escapeHtml(r.email)}${r.phone ? ' · ' + escapeHtml(r.phone) : ''}</div>
          </div>
          <div class="entry-actions">
            <select class="status-select">
              <option ${r.status === 'New' ? 'selected' : ''}>New</option>
              <option ${r.status === 'Contacted' ? 'selected' : ''}>Contacted</option>
              <option ${r.status === 'Accepted' ? 'selected' : ''}>Accepted</option>
              <option ${r.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
            </select>
          </div>
        </div>
        ${r.availability ? `<div class="entry-meta" style="margin-top:8px;">Availability: ${escapeHtml(r.availability)}</div>` : ''}
        ${r.platforms && r.platforms.length ? `<div class="entry-tags">${r.platforms.map((p) => `<span class="tag-chip">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
        <div class="entry-body">${escapeHtml(r.message)}</div>
      </div>
    `).join('');

    container.querySelectorAll('.entry-card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('.status-select').addEventListener('change', async (e) => {
        await api(`/api/admin/recruits/${id}`, { method: 'PUT', body: JSON.stringify({ status: e.target.value }) });
      });
    });
  }

  checkSession();
})();
