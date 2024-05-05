// Typings for the DocumentPictureInPicture API
// Follows the WICG spec: https://wicg.github.io/document-picture-in-picture

type GlobalWindow = typeof window;

interface DocumentPictureInPictureOptions {
    /** Sets the initial width of the Picture-in-Picture window. */
    width?: number;
    /** Sets the initial height of the Picture-in-Picture window. */
    height?: number;
    /** Hides the "back to tab" button in the Picture-in-Picture window if true. It is false by default. */
    disallowReturnToOpener?: boolean;
}

declare class DocumentPictureInPicture extends EventTarget {
    requestWindow(options?: DocumentPictureInPictureOptions): Promise<GlobalWindow>;
    readonly window: GlobalWindow | null;
}

declare global {
    const documentPictureInPicture: DocumentPictureInPicture;
}

export {};
