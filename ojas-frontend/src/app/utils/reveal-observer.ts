/**
 * One IntersectionObserver for every entrance animation on the page, rather than one each.
 *
 * The home page now reveals dozens of pieces - every heading, card row and panel - and an
 * observer per element meant dozens of observers doing the same geometry on every scroll frame.
 * One shared observer does it once. Each element is watched until it first enters, then dropped:
 * an entrance happens once (see ScrollRevealDirective for why it never replays).
 *
 * No threshold, and a bottom inset instead. A threshold is a fraction of the element, so a tall
 * enough panel on a short phone can never reach it and would stay invisible for good; "its top
 * has come a tenth of the way up the screen" works for any height.
 */
type OnEnter = () => void;

const waiting = new Map<Element, OnEnter>();
let observer: IntersectionObserver | null = null;

export function observeOnce(el: Element, onEnter: OnEnter): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onEnter();
    return () => {};
  }

  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = waiting.get(entry.target);
        waiting.delete(entry.target);
        observer?.unobserve(entry.target);
        callback?.();
      }
    },
    { threshold: 0, rootMargin: '0px 0px -10% 0px' },
  );

  waiting.set(el, onEnter);
  observer.observe(el);

  return () => {
    if (waiting.delete(el)) observer?.unobserve(el);
  };
}
