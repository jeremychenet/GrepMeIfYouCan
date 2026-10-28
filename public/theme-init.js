// Sets data-theme on <html> before first paint, so there is no flash of the
// wrong theme. Loaded as a blocking external script in <head>: the CSP
// forbids inline scripts. Logic mirrors src/lib/theme.ts (same storage key).
(function () {
  var theme = 'light';
  var saved = null;
  try {
    saved = localStorage.getItem('gmiyc:v1:theme');
  } catch (e) {}
  if (saved === 'dark' || saved === 'light') {
    theme = saved;
  } else {
    try {
      if (matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
    } catch (e) {}
  }
  document.documentElement.dataset.theme = theme;
})();
