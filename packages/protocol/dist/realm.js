/** A realm name: letters, digits, spaces, apostrophes and hyphens, 2 to 40 characters once trimmed. */
export function validRealm(name) {
    if (typeof name !== "string")
        return false;
    const realm = name.trim();
    return realm.length >= 2 && realm.length <= 40 && /^[\p{L}\p{N}][\p{L}\p{N} '\u2019-]*$/u.test(realm);
}
