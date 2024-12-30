export const isServedInIframe = (): boolean => {
    return window.self !== window.top;
};
