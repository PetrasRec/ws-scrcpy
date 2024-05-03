// Typings for the DocumentPictureInPicture API
// Follows the WICG spec: https://wicg.github.io/document-picture-in-picture

type GlobalWindow = typeof window;

interface DocumentPictureInPictureOptions {
    width?: number;
    height?: number;
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
