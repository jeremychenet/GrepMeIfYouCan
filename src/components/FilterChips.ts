// Category chips (one category at a time) and active tag chips (click to
// remove). Reports changes through `onChange`; the URL is the caller's job.
import type { SearchState } from '../lib/search-state';

type Patch = (state: SearchState) => SearchState;

export function createFilterChips(root: HTMLElement, onChange: (patch: Patch) => void) {
  const catGroup = root.querySelector<HTMLElement>('[data-category-chips]')!;
  const catButtons = [...catGroup.querySelectorAll<HTMLButtonElement>('[data-cat]')];
  const tagGroup = root.querySelector<HTMLElement>('[data-active-tags]')!;
  const tagChip = root.querySelector<HTMLTemplateElement>('[data-tag-chip-template]')!.content;

  catGroup.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-cat]');
    if (!button) return;
    const cat = (button.dataset['cat'] || null) as SearchState['cat'];
    onChange((s) => ({ ...s, cat }));
  });

  tagGroup.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-tag]');
    if (!button) return;
    const tag = button.dataset['tag']!;
    onChange((s) => ({ ...s, tags: s.tags.filter((t) => t !== tag) }));
    // The removed chip had focus: hand it back to the search box.
    root.querySelector<HTMLInputElement>('[data-search-input]')?.focus();
  });

  return {
    update(state: SearchState): void {
      for (const b of catButtons) {
        b.setAttribute('aria-pressed', String((b.dataset['cat'] || null) === state.cat));
      }
      tagGroup.replaceChildren(
        ...state.tags.map((t) => {
          const chip = tagChip.cloneNode(true) as DocumentFragment;
          const button = chip.querySelector('button')!;
          button.dataset['tag'] = t;
          button.setAttribute('aria-label', `Remove tag filter ${t}`);
          chip.querySelector('[data-tag-name]')!.textContent = t;
          return chip;
        }),
      );
      tagGroup.hidden = state.tags.length === 0;
    },
  };
}
