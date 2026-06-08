(function() {
  const MAINTENANCE = true;
  const BYPASS_KEY  = 'eb_bypass';
  const MAINT_PAGE  = '/maintenance.html';

  if (!MAINTENANCE) return;
  if (sessionStorage.getItem(BYPASS_KEY) === '1') return;
  if (window.location.pathname === MAINT_PAGE) return;

  window.location.replace(MAINT_PAGE);
})();
