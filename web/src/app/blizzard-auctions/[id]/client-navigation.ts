/**
 * A client-side move (or prefetch) asks for the page as an RSC payload (the `RSC` request header), which lands in the
 * document that asked, one that may have loaded ads. Such a request gets no prices, only a reload of the address.
 */
export const isClientNavigation = (h: Headers) => h.get("rsc") !== null || h.get("next-router-prefetch") !== null;
