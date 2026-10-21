/* Bulldogs Watch Party — Google sign-in and Google Drive (milestone 3a).
   Uses the narrow "drive.file" permission: the app only sees files it created or that a coach picked. */
(function (root) {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER = 'application/vnd.google-apps.folder';
  const TOKEN_KEY = 'bwp-google-token';

  let token = null;
  let tokenExp = 0;
  let tokenClient = null;
  const scripts = {};

  function cfg() { return root.WP_CONFIG || {}; }
  function configured() { return !!cfg().googleClientId; }
  function webOrigin() { return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'; }

  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = res;
        s.onerror = () => { delete scripts[src]; rej(new Error('Couldn’t reach Google. Check the internet connection.')); };
        document.head.append(s);
      });
    }
    return scripts[src];
  }

  function restoreToken() {
    try {
      const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.exp > Date.now() + 60000) { token = t.token; tokenExp = t.exp; }
    } catch (e) { /* private mode etc. */ }
  }
  restoreToken();

  function hasToken() { return !!token && tokenExp > Date.now() + 30000; }

  /** Ask Google for an access token. Must be called from a click (it may open a pop-up). */
  async function signIn(hint) {
    if (!configured()) throw new Error('Google sign-in isn’t set up yet');
    if (!webOrigin()) throw new Error('Google sign-in only works on the web version of the app');
    await loadScript('https://accounts.google.com/gsi/client');
    return new Promise((resolve, reject) => {
      tokenClient = root.google.accounts.oauth2.initTokenClient({
        client_id: cfg().googleClientId,
        scope: SCOPE,
        callback: (r) => {
          if (r.error) { reject(new Error(r.error_description || r.error)); return; }
          token = r.access_token;
          tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: tokenExp })); } catch (e) { /* ignore */ }
          resolve(token);
        },
        error_callback: (e) => reject(new Error(e && e.type === 'popup_closed' ? 'Sign-in window was closed' : 'Google sign-in failed'))
      });
      tokenClient.requestAccessToken(hint ? { login_hint: hint } : {});
    });
  }

  function signOut() {
    if (token && root.google && root.google.accounts && root.google.accounts.oauth2) {
      try { root.google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* ignore */ }
    }
    token = null; tokenExp = 0;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  async function call(method, url, body, headers, as) {
    if (!hasToken()) { const e = new Error('Signed out of Google'); e.code = 401; throw e; }
    let res;
    try {
      res = await fetch(url, { method, body, headers: Object.assign({ Authorization: 'Bearer ' + token }, headers || {}) });
    } catch (e) {
      const err = new Error('No connection to Google Drive');
      err.code = 0;
      throw err;
    }
    if (res.status === 401) { token = null; tokenExp = 0; const e = new Error('Signed out of Google'); e.code = 401; throw e; }
    if (!res.ok) {
      let msg = 'Google Drive error ' + res.status;
      try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* ignore */ }
      const e = new Error(msg); e.code = res.status; throw e;
    }
    if (as === 'text') return res.text();
    if (as === 'blob') return res.blob();
    if (res.status === 204) return null;
    return res.json();
  }

  const json = (o) => ({ body: JSON.stringify(o), headers: { 'Content-Type': 'application/json' } });
  const META = 'id,name,version,modifiedTime,trashed,parents,lastModifyingUser(displayName,emailAddress)';

  async function whoAmI() {
    const r = await call('GET', API + '/about?fields=' + encodeURIComponent('user(displayName,emailAddress)'));
    return { email: (r.user.emailAddress || '').toLowerCase(), name: r.user.displayName || '' };
  }

  async function createFolder(name, parentId) {
    const b = json({ name, mimeType: FOLDER, parents: parentId ? [parentId] : undefined });
    return call('POST', API + '/files?fields=id,name', b.body, b.headers);
  }

  async function createFile(name, parentId, text, mimeType) {
    const boundary = 'bwp' + Math.random().toString(36).slice(2);
    const meta = { name, parents: parentId ? [parentId] : undefined, mimeType: mimeType || 'application/json' };
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
      '\r\n--' + boundary + '\r\nContent-Type: ' + (mimeType || 'application/json') + '\r\n\r\n' + text + '\r\n--' + boundary + '--';
    return call('POST', UPLOAD + '/files?uploadType=multipart&fields=' + encodeURIComponent(META), body, { 'Content-Type': 'multipart/related; boundary=' + boundary });
  }

  function getMeta(id) { return call('GET', API + '/files/' + encodeURIComponent(id) + '?fields=' + encodeURIComponent(META)); }
  function readText(id) { return call('GET', API + '/files/' + encodeURIComponent(id) + '?alt=media', null, null, 'text'); }
  function updateText(id, text) {
    return call('PATCH', UPLOAD + '/files/' + encodeURIComponent(id) + '?uploadType=media&fields=' + encodeURIComponent(META), text, { 'Content-Type': 'application/json' });
  }

  /** Files this app can see (ones it created on any of this coach's devices) with this exact name. */
  async function findByName(name, mimeType) {
    const esc = (v) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = "name = '" + esc(name) + "' and trashed = false" + (mimeType ? " and mimeType = '" + mimeType + "'" : '');
    const r = await call('GET', API + '/files?q=' + encodeURIComponent(q) + '&spaces=drive&orderBy=createdTime&fields=' + encodeURIComponent('files(' + META + ')'));
    return r.files || [];
  }

  /** Upload a video (or any blob) in two steps: create the file, then send its bytes. */
  async function uploadBlob(name, parentId, blob, description) {
    const b = json({ name, parents: parentId ? [parentId] : undefined, mimeType: blob.type || 'video/mp4', description: description || undefined });
    const f = await call('POST', API + '/files?fields=id,name', b.body, b.headers);
    return call('PATCH', UPLOAD + '/files/' + encodeURIComponent(f.id) + '?uploadType=media&fields=' + encodeURIComponent('id,name,webViewLink'), blob, { 'Content-Type': blob.type || 'video/mp4' });
  }

  function downloadBlob(id) { return call('GET', API + '/files/' + encodeURIComponent(id) + '?alt=media', null, null, 'blob'); }

  function trash(id) {
    const b = json({ trashed: true });
    return call('PATCH', API + '/files/' + encodeURIComponent(id) + '?fields=id', b.body, b.headers);
  }

  async function share(id, email, message) {
    const b = json({ role: 'writer', type: 'user', emailAddress: email });
    const q = '?sendNotificationEmail=true' + (message ? '&emailMessage=' + encodeURIComponent(message) : '') + '&fields=id';
    return call('POST', API + '/files/' + encodeURIComponent(id) + '/permissions' + q, b.body, b.headers);
  }

  /** Let the coach pick the shared team data file (grants this app access to it). */
  async function pickFile(opts) {
    const o = opts || {};
    const c = cfg();
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((res, rej) => root.gapi.load('picker', { callback: res, onerror: () => rej(new Error('Couldn’t open the Google file picker')) }));
    const P = root.google.picker;
    return new Promise((resolve) => {
      const view = new P.DocsView(P.ViewId.DOCS).setMimeTypes('application/json').setQuery(o.query || 'Watch Party').setIncludeFolders(true);
      const builder = new P.PickerBuilder();
      if (o.multi && P.Feature && P.Feature.MULTISELECT_ENABLED) builder.enableFeature(P.Feature.MULTISELECT_ENABLED);
      const picker = builder
        .setTitle(o.title || 'Pick “Watch Party team data” and “Watch Party clip library” (Bulldogs Watch Party › _App, shared with you)')
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(c.googleApiKey)
        .setAppId(c.googleAppId)
        .setCallback((d) => {
          if (d.action === P.Action.PICKED) resolve(o.multi ? (d.docs || []).map((x) => ({ id: x.id, name: x.name })) : (d.docs && d.docs[0] ? d.docs[0].id : null));
          else if (d.action === P.Action.CANCEL) resolve(null);
        })
        .build();
      picker.setVisible(true);
    });
  }

  root.WPDrive = { SCOPE, FOLDER, configured, webOrigin, hasToken, signIn, signOut, whoAmI, createFolder, createFile, getMeta, readText, updateText, share, pickFile, findByName, uploadBlob, downloadBlob, trash };
})(window);
