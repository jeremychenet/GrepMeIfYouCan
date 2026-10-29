// Runs before first paint (blocking external script in <head>: the CSP
// forbids inline scripts).
// 1. Sets data-theme on <html>, so there is no flash of the wrong theme.
//    Logic mirrors src/lib/theme.ts (same storage key): dark by default,
//    unless the visitor chose light with the toggle.
// 2. Sets data-initial-search when the URL carries a search (q, cat, tag;
//    src/lib/search-state.ts): the home page then reserves the screen
//    height for the results that render later (CLS), and otherwise fits
//    the screen with its footer in view (SPEC §3.1).
(function () {
  var root = document.documentElement;
  var theme = 'dark';
  try {
    if (localStorage.getItem('gmiyc:v1:theme') === 'light') theme = 'light';
  } catch (e) {}
  root.dataset.theme = theme;
  if (/[?&](q|cat|tag)=/.test(location.search)) root.dataset.initialSearch = '';
})();
