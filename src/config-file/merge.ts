type JsonObject = Record<string, unknown>;

function is_plain_object(value: unknown): value is JsonObject {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value);
}

export function deep_merge_config<T>(client: T, project: unknown): T {
    if (project === undefined || project === null) {
        return structuredClone(client);
    }
    // Arrays and non-object scalars from project replace the client value
    // wholesale.
    if (!is_plain_object(project)) {
        return structuredClone(project) as T;
    }

    const base: JsonObject = is_plain_object(client) ? client : {};
    const result: JsonObject = {};

    // Client-only keys: clone straight across (project never touches them).
    for (const [key, value] of Object.entries(base)) {
        if (!(key in project)) {
            result[key] = structuredClone(value);
        }
    }

    // Project keys: recurse into overlapping objects (cloning happens once,
    // inside the recursion), otherwise clone objects/arrays and copy
    // immutable primitives directly.
    for (const [key, value] of Object.entries(project)) {
        if (is_plain_object(base[key]) && is_plain_object(value)) {
            result[key] = deep_merge_config(base[key], value);
        } else if (typeof value === 'object' && value !== null) {
            result[key] = structuredClone(value);
        } else {
            result[key] = value;
        }
    }

    return result as T;
}
