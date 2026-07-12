/**
 * Gate diagnostics publication by document version and lifecycle/force epoch.
 *
 * Epochs are allocated globally so a URI cannot reuse an epoch after
 * `forget()`. This makes a close a hard publication boundary: work that
 * captured the retired epoch before the close cannot publish after the URI is
 * forgotten or reopened.
 */
export class DiagnosticsPublishGate {
    private last_published_version: Map<string, number> = new Map();
    private last_published_epoch: Map<string, number> = new Map();
    private current_epoch: Map<string, number> = new Map();
    private next_epoch = 0;

    get_current_epoch(uri: string): number {
        let my_epoch = this.current_epoch.get(uri);
        if (my_epoch === undefined) {
            my_epoch = this.allocate_epoch();
            this.current_epoch.set(uri, my_epoch);
        }
        return my_epoch;
    }

    is_current_epoch(uri: string, epoch: number): boolean {
        return this.current_epoch.get(uri) === epoch;
    }

    would_publish(uri: string, version: number, epoch: number): boolean {
        if (!this.is_current_epoch(uri, epoch)) {
            return false;
        }

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
        if (!this.is_current_epoch(uri, epoch)) {
            return false;
        }

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
        this.current_epoch.set(uri, this.allocate_epoch());
    }

    forget(uri: string): void {
        this.last_published_version.delete(uri);
        this.last_published_epoch.delete(uri);
        this.current_epoch.delete(uri);
    }

    private allocate_epoch(): number {
        const my_epoch = this.next_epoch;
        this.next_epoch++;
        return my_epoch;
    }
}
