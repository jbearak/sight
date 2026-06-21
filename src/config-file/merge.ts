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
    if (Array.isArray(project)) {
        return structuredClone(project) as T;
    }
    if (!is_plain_object(project)) {
        return structuredClone(project) as T;
    }

    const result: JsonObject = is_plain_object(client)
        ? structuredClone(client)
        : {};

    for (const [key, value] of Object.entries(project)) {
        if (is_plain_object(result[key]) && is_plain_object(value)) {
            result[key] = deep_merge_config(result[key], value);
        } else {
            result[key] = structuredClone(value);
        }
    }

    return result as T;
}
