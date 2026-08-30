(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('.nav');
    if (!nav || nav.querySelector('[data-pos-return-link]')) return;
    const a = document.createElement('a');
    a.href = './returns.html';
    a.dataset.posReturnLink = '1';
    a.textContent = '↩ Возврат';
    const logout = nav.querySelector('#logoutSide');
    nav.insertBefore(a, logout || null);
  });
})();
