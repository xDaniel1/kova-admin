export const state = { role: 'admin' }; export let banners = 0; export const clearBanner = () => { globalThis.__bannerCleared = (globalThis.__bannerCleared||0)+1; };
