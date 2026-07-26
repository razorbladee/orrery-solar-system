(() => {
  const $ = (id) => document.getElementById(id);
  const pages = [...document.querySelectorAll('.page')];
  const nav = [...document.querySelectorAll('.rail-btn')];
  const show = (name) => {
    pages.forEach((page) => page.classList.toggle('active', page.dataset.page === name));
    nav.forEach((button) => button.classList.toggle('active', button.dataset.view === name));
    if (name === 'system') window.dispatchEvent(new Event('resize'));
  };
  nav.forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault();
    show(button.dataset.view);
  }, true));
  const compare = $('compare-dialog');
  $('compare-btn')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (compare && !compare.open) compare.showModal();
  }, true);
  $('close-compare')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (compare?.open) compare.close();
  }, true);
  document.querySelectorAll('[data-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      try {
        const key = input.dataset.setting;
        const stored = JSON.parse(localStorage.getItem('orrery-v3') || '{}');
        stored[key] = input.checked;
        localStorage.setItem('orrery-v3', JSON.stringify(stored));
      } catch {}
    });
  });
})();
