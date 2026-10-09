// Independent reference: set difference on explicit item dependency edges (L01).
export function expectedMissingDependencies(items) {
    const ids = new Set(items.map((i) => i.id));
    return items
        .flatMap((item) => {
        const missing = item.dependsOn.filter((dep) => !ids.has(dep));
        return missing.length ? [{ itemId: item.id, missing: [...missing].sort() }] : [];
    })
        .sort((a, b) => a.itemId.localeCompare(b.itemId));
}
