// RELAY — public site behaviour
(function () {
  'use strict';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function postJSON(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    let json = {};
    try { json = await res.json(); } catch (_) { /* ignore */ }
    return { ok: res.ok, status: res.status, data: json };
  }

  // ---- Roster ----
  async function loadRoster() {
    const body = document.getElementById('roster-body');
    const metaActive = document.getElementById('meta-active');
    try {
      const res = await fetch('/api/members');
      const { members } = await res.json();
      if (!members || !members.length) {
        body.innerHTML = '<div class="roster-row"><div></div><div class="roster-name">No members listed yet</div><div></div><div></div></div>';
        return;
      }
      body.innerHTML = members.map((m) => `
        <div class="roster-row">
          <div class="roster-id">${escapeHtml(m.memberId || '—')}</div>
          <div class="roster-name">${escapeHtml(m.name)}</div>
          <div class="roster-role">${escapeHtml(m.role || '')}</div>
          <div><span class="status-pill ${m.status === 'Active' ? 'active' : 'offline'}">${escapeHtml(m.status)}</span></div>
        </div>
      `).join('');
      const activeCount = members.filter((m) => m.status === 'Active').length;
      if (metaActive) metaActive.textContent = `${activeCount}/${members.length}`;
    } catch (err) {
      body.innerHTML = '<div class="roster-row"><div></div><div class="roster-name">Could not load the roster. Try refreshing.</div><div></div><div></div></div>';
    }
  }

  // ---- Member ID check ----
  function wireIdCheck() {
    const form = document.getElementById('id-check-form');
    const input = document.getElementById('id-check-input');
    const result = document.getElementById('id-check-result');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const memberId = input.value.trim();
      if (!memberId) return;
      result.classList.remove('hidden');
      result.innerHTML = 'Checking…';
      try {
        const { data } = await postJSON('/api/verify-id', { memberId });
        if (data.valid) {
          result.innerHTML = `<span class="ok">✓ Verified</span> — ${escapeHtml(data.member.name)}, ${escapeHtml(data.member.role)} (${escapeHtml(data.member.status)})`;
        } else {
          result.innerHTML = `<span class="no">✕ No member found with ID "${escapeHtml(memberId)}"</span>`;
        }
      } catch (err) {
        result.innerHTML = '<span class="no">Could not check that ID right now. Try again shortly.</span>';
      }
    });
  }

  // ---- Recruitment form ----
  function wireRecruitForm() {
    const form = document.getElementById('recruit-form');
    const msg = document.getElementById('recruit-msg');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const platforms = fd.getAll('platforms');
      const payload = {
        name: fd.get('name'),
        email: fd.get('email'),
        phone: fd.get('phone'),
        availability: fd.get('availability'),
        message: fd.get('message'),
        platforms,
      };
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      msg.textContent = 'Sending…';
      msg.className = 'form-msg';
      try {
        const { ok, data } = await postJSON('/api/recruit', payload);
        if (ok) {
          msg.textContent = 'Application received — we\'ll be in touch.';
          msg.className = 'form-msg ok';
          form.reset();
        } else {
          msg.textContent = data.error || 'Something went wrong. Try again.';
          msg.className = 'form-msg error';
        }
      } catch (err) {
        msg.textContent = 'Network error — try again in a moment.';
        msg.className = 'form-msg error';
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ---- Problem report form ----
  function wireReportForm() {
    const form = document.getElementById('report-form');
    const msg = document.getElementById('report-msg');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: fd.get('name'),
        contact: fd.get('contact'),
        category: fd.get('category'),
        urgency: fd.get('urgency'),
        description: fd.get('description'),
      };
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      msg.textContent = 'Sending…';
      msg.className = 'form-msg';
      try {
        const { ok, data } = await postJSON('/api/report', payload);
        if (ok) {
          msg.textContent = 'Report sent — someone on shift has been notified.';
          msg.className = 'form-msg ok';
          form.reset();
        } else {
          msg.textContent = data.error || 'Something went wrong. Try again.';
          msg.className = 'form-msg error';
        }
      } catch (err) {
        msg.textContent = 'Network error — try again in a moment.';
        msg.className = 'form-msg error';
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadRoster();
    wireIdCheck();
    wireRecruitForm();
    wireReportForm();
  });
})();
