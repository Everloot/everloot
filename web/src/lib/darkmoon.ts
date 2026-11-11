import reference from "../../../kb/curated/darkmoon-turnins.json";

/** Community reference only: these rows are not player-observed relations. */
export const DARKMOON = reference;
export const DARKMOON_HREF = "/guides/darkmoon-faire";
export const DARKMOON_STATUS = "Community-sourced · unverified in Forever";
export const darkmoonSearchHref = (name: string) => `/search?q=${encodeURIComponent(name)}`;
