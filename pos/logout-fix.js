(() => {
  const authKey = key => {
    const k = String(key || '');
    return /^sb-.*-auth-token$/i.test(k)
      || /^a4print_mobile_(access|refresh|expires)$/i.test(k)
      || k === 'a4print_auth_return_to';
  };

  function clearStore(store) {
    try {
      const keys = [];
      for (let i = 0; i < store.length; i += 1) keys.push(store.key(i));
      keys.filter(authKey).forEach(key => store.removeItem(key));
    } catch (_) {}
  }

  function forceLogout() {
    clearStore(localStorage);
    clearStore(sessionStorage);
    try { window.name = ''; } catch (_) {}
    location.replace(`./login.html?logout=1&ts=${Date.now()}`);
  }

  function bind() {
    const button = document.getElementById('logout');
    if (!button || button.dataset.forceLogoutBound === '1') return;
    button.dataset.forceLogoutBound = '1';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      button.disabled = true;
      button.textContent = 'Выходим…';
      forceLogout();
    }, true);
  }

  window.A4POS_FORCE_LOGOUT = forceLogout;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
