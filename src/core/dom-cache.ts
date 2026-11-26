export class DomQueryCache {
  private readonly observer: MutationObserver;
  private cache = new WeakMap<ParentNode, Map<string, Element[]>>();
  private firstResult = new WeakMap<ParentNode, Map<string, Element | null>>();
  private readonly maxSelectorsPerRoot = 128;

  constructor(root: Node = document.documentElement) {
    this.observer = new MutationObserver(() => this.clear());
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['name', 'role', 'placeholder', 'aria-label', 'aria-expanded', 'disabled', 'hidden'],
    });
  }

  queryAll<T extends Element = Element>(selector: string, root: ParentNode = document): T[] {
    let selectors = this.cache.get(root);
    if (!selectors) {
      selectors = new Map<string, Element[]>();
      this.cache.set(root, selectors);
    }

    let result = selectors.get(selector);
    if (!result) {
      result = Array.from(root.querySelectorAll<Element>(selector));
      if (selectors.size >= this.maxSelectorsPerRoot) {
        const oldest = selectors.keys().next().value;
        if (oldest !== undefined) selectors.delete(oldest);
      }
      selectors.set(selector, result);
    }
    return result.slice() as T[];
  }

  query<T extends Element = Element>(selector: string, root: ParentNode = document): T | null {
    let selectors = this.firstResult.get(root);
    if (!selectors) {
      selectors = new Map<string, Element | null>();
      this.firstResult.set(root, selectors);
    }

    if (!selectors.has(selector)) selectors.set(selector, root.querySelector<Element>(selector));
    return selectors.get(selector) as T | null;
  }

  clear(): void {
    this.cache = new WeakMap<ParentNode, Map<string, Element[]>>();
    this.firstResult = new WeakMap<ParentNode, Map<string, Element | null>>();
  }

  disconnect(): void {
    this.observer.disconnect();
    this.clear();
  }
}
