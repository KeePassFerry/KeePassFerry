// Fields inside a shadow root are not listed in document.forms nor returned by
// getElementsByTagName on the document so we have to look for them separately.
// Closed shadow roots are not accessible to us so only open ones are found.

export function findOpenShadowRoots(root: Node): ShadowRoot[] {
    const shadowRoots: ShadowRoot[] = [];
    const addShadowRootOf = (node: Node) => {
        const shadowRoot = (node as Element).shadowRoot;
        if (shadowRoot) {
            shadowRoots.push(shadowRoot);
            shadowRoots.push(...findOpenShadowRoots(shadowRoot));
        }
    };

    addShadowRootOf(root);
    const doc = root.ownerDocument ?? (root as Document);
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
        addShadowRootOf(walker.currentNode);
    }
    return shadowRoots;
}

export function findInputsInOpenShadowRoots(root: Node): HTMLInputElement[] {
    return findOpenShadowRoots(root).flatMap(shadowRoot =>
        Array.from(shadowRoot.querySelectorAll("input"))
    );
}

// Whether the shadow host containing this element (directly or through
// nested shadow roots) is inside a form in the main document
export function isHostedInForm(element: Element) {
    let host = element;
    let root = host.getRootNode();
    while (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && (root as ShadowRoot).host) {
        host = (root as ShadowRoot).host;
        root = host.getRootNode();
    }
    return host !== element && !!host.closest("form");
}
