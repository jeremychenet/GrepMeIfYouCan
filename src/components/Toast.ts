// Shows a short message in the page's toast (Toast.astro), announced by
// screen readers through its aria-live region.
const VISIBLE_MS = 2500;
let timer: number | undefined;

export function showToast(message: string): void {
  const toast = document.querySelector<HTMLElement>('[data-toast]');
  if (!toast) return;
  window.clearTimeout(timer);
  // Empty first, so the same message twice in a row is announced again.
  toast.textContent = '';
  toast.classList.remove('is-visible');
  window.requestAnimationFrame(() => {
    toast.textContent = message;
    toast.classList.add('is-visible');
    timer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
      toast.textContent = '';
    }, VISIBLE_MS);
  });
}
