/**
 * Gate diagnostics publication by document version and per-URI force epoch.
 */
export class DiagnosticsPublishGate {
    private last_published_version: Map<string, number> = new Map();
    private last_published_epoch: Map<string, number> = new Map();
    private current_epoch: Map<string, number> = new Map();

    get_current_epoch(uri: string): number {
        return this.current_epoch.get(uri) ?? 0;
    }

    would_publish(uri: string, version: number, epoch: number): boolean {
        const my_last_version = this.last_published_version.get(uri);
        if (my_last_version === undefined || version > my_last_version) {
            return true;
        }

        if (version < my_last_version) {
            return false;
        }

        const my_current_epoch = this.current_epoch.get(uri) ?? 0;
        const my_last_epoch = this.last_published_epoch.get(uri) ?? 0;
        return epoch === my_current_epoch && epoch > my_last_epoch;
    }

    try_consume_publish(uri: string, version: number, epoch: number): boolean {
        const my_last_version = this.last_published_version.get(uri);
        if (my_last_version === undefined || version > my_last_version) {
            this.last_published_version.set(uri, version);
            this.last_published_epoch.set(uri, epoch);
            return true;
        }

        if (version < my_last_version) {
            return false;
        }

        const my_current_epoch = this.current_epoch.get(uri) ?? 0;
        const my_last_epoch = this.last_published_epoch.get(uri) ?? 0;
        if (epoch === my_current_epoch && epoch > my_last_epoch) {
            this.last_published_epoch.set(uri, epoch);
            return true;
        }

        return false;
    }

    mark_force_republish(uri: string): void {
        this.current_epoch.set(uri, (this.current_epoch.get(uri) ?? 0) + 1);
    }

    forget(uri: string): void {
        this.last_published_version.delete(uri);
        this.last_published_epoch.delete(uri);
        this.current_epoch.delete(uri);
    }
}
