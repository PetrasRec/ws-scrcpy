/**
 * A stateless helper class that wraps a `window` object for context-agnostic (iframe, PIP, etc) operations
 */
export class CurrentWindow {
    /** The main browser window */
    public static main = new CurrentWindow(window);

    /** The popped out PIP window, if there is one */
    public static get pipWindow(): CurrentWindow | null {
        return documentPictureInPicture.window && new CurrentWindow(documentPictureInPicture.window);
    }

    public document: Document;

    constructor(public currentWindow: typeof window) {
        this.document = currentWindow.document;
    }

    /**
     * Copies stylesheets from the main window onto this window
     */
    public copyStylesheets(): void {
        const source = CurrentWindow.main.document;
        const target = this.document;

        for (const styleSheet of Array.from(source.styleSheets)) {
            const style = target.createElement('style');
            const cssRules = Array.from(styleSheet.cssRules)
                .map((rule) => rule.cssText)
                .join('');

            style.textContent = cssRules;
            target.head.appendChild(style);
        }
    }

    /**
     * Checks if a value is an instance of a class in the current window context
     * This is needed because each window context has it's own instances:
     * $('iframe').contentWindow.window.MouseEvent != window.MouseEvent
     *
     * @param value The value to evaluate instanceness of (e.g. `value instanceof RHS`)
     * @param key The string name of the class to check against (e.g. `'MouseEvent'`)
     */
    public instanceOf<T extends keyof typeof globalThis>(
        value: unknown,
        key: T,
    ): value is InstanceType<typeof globalThis[T]> {
        const klass = this.currentWindow[key];
        return typeof klass === 'function' && value instanceof klass;
    }
}
