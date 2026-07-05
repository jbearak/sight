/**
 * Gate diagnostics publication by document version, while allowing counted
 * same-version force republishes for dependency-triggered recomputation.
 */
export class DiagnosticsPublishGate {
    private last_published: Map<string, number> = new Map();
    private force_budget: Map<string, number> = new Map();

    would_publish(uri: string, version: number): boolean {
        const last_version = this.last_published.get(uri);
        if (last_version === undefined || version > last_version) {
            return true;
        }

        const budget = this.force_budget.get(uri) ?? 0;
        return version === last_version && budget > 0;
    }

    try_consume_publish(uri: string, version: number): boolean {
        const last_version = this.last_published.get(uri);
        if (last_version === undefined || version > last_version) {
            this.last_published.set(uri, version);
            this.force_budget.delete(uri);
            return true;
        }

        const budget = this.force_budget.get(uri) ?? 0;
        if (version === last_version && budget > 0) {
            if (budget === 1) {
                this.force_budget.delete(uri);
            } else {
                this.force_budget.set(uri, budget - 1);
            }
            return true;
        }

        return false;
    }

    mark_force_republish(uri: string): void {
        const budget = this.force_budget.get(uri) ?? 0;
        this.force_budget.set(uri, budget + 1);
    }

    forget(uri: string): void {
        this.last_published.delete(uri);
        this.force_budget.delete(uri);
    }
}
