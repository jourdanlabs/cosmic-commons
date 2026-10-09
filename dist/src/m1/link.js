export function evaluateLink(context) {
    const items = context.snapshot.items;
    const byId = new Map(items.map((item) => [item.id, item]));
    const issues = [];
    for (const item of items) {
        for (const dep of item.dependsOn) {
            if (!byId.has(dep)) {
                issues.push({
                    code: 'MISSING_DEPENDENCY',
                    itemId: item.id,
                    owner: item.owner,
                    dependencyIds: [dep],
                    question: `Supply dependency ${dep} referenced by ${item.id}, or submit a corrected dependency declaration.`,
                });
            }
        }
    }
    const itemIds = [...byId.keys()];
    const dependencies = new Map();
    const dependents = new Map();
    for (const id of itemIds) {
        dependencies.set(id, [...(byId.get(id)?.dependsOn ?? [])]);
        dependents.set(id, []);
    }
    for (const item of items) {
        for (const dep of item.dependsOn) {
            if (dependents.has(dep))
                dependents.get(dep).push(item.id);
        }
    }
    const visited = new Set();
    const finished = [];
    for (const id of itemIds) {
        if (visited.has(id))
            continue;
        visited.add(id);
        const stack = [{ id, next: 0 }];
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const edges = (dependencies.get(frame.id) ?? []).filter((d) => byId.has(d));
            if (frame.next === edges.length) {
                finished.push(frame.id);
                stack.pop();
                continue;
            }
            const child = edges[frame.next++];
            if (!visited.has(child)) {
                visited.add(child);
                stack.push({ id: child, next: 0 });
            }
        }
    }
    visited.clear();
    for (let index = finished.length - 1; index >= 0; index--) {
        const id = finished[index];
        if (visited.has(id))
            continue;
        visited.add(id);
        const members = [];
        const stack = [id];
        while (stack.length) {
            const member = stack.pop();
            members.push(member);
            for (const parent of dependents.get(member) ?? []) {
                if (!visited.has(parent)) {
                    visited.add(parent);
                    stack.push(parent);
                }
            }
        }
        const cyclic = members.length > 1 || (dependencies.get(id) ?? []).includes(id);
        if (cyclic) {
            const sorted = [...new Set(members)].sort();
            const memberSet = new Set(sorted);
            const anchor = sorted[0];
            const question = sorted.length <= 32
                ? `Correct the dependency cycle involving ${sorted.join(', ')}.`
                : `DEPENDENCY_CYCLE component ${anchor} size ${sorted.length}`;
            for (const itemId of sorted) {
                const cyclicDeps = (dependencies.get(itemId) ?? []).filter((d) => memberSet.has(d)).sort();
                issues.push({
                    code: 'DEPENDENCY_CYCLE',
                    itemId,
                    owner: byId.get(itemId)?.owner ?? 'unknown-owner',
                    dependencyIds: cyclicDeps.length ? cyclicDeps : [anchor],
                    question,
                });
            }
        }
    }
    issues.sort((a, b) => (a.code === b.code ? (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0) : a.code < b.code ? -1 : 1));
    return { issues };
}
