/** Immutable diagnostic state captured when validation is scheduled. */
export interface DiagnosticsTrigger {
    readonly lifecycle_epoch: number;
    readonly document_version: number;
    readonly force_epoch: number;
}

interface DiagnosticsLifecycleState {
    lifecycle_epoch: number;
    document_version: number;
    force_epoch: number;
    last_published_version?: number;
    last_published_force_epoch?: number;
}

/**
 * Gate diagnostic publication by document version and explicit lifecycle.
 *
 * Only didOpen begins a lifecycle. Close and shutdown retire it, while normal
 * edits advance its document version and dependency/configuration changes
 * advance its force epoch. Publication never creates or advances lifecycle
 * state, so old work fails closed at its final commit.
 */
export class DiagnosticsPublishGate {
    private lifecycle_by_uri = new Map<string, DiagnosticsLifecycleState>();
    private next_lifecycle_epoch = 0;

    begin_lifecycle(uri: string, version: number): DiagnosticsTrigger {
        const state: DiagnosticsLifecycleState = {
            lifecycle_epoch: this.next_lifecycle_epoch++,
            document_version: version,
            force_epoch: 0,
        };
        this.lifecycle_by_uri.set(uri, state);
        return this.trigger_from(state);
    }

    /**
     * Record the newest version scheduled for validation and capture its
     * trigger. Older versions never move the lifecycle backwards; their
     * returned trigger is intentionally stale and will fail validation.
     */
    trigger_for_validation(
        uri: string,
        version: number
    ): DiagnosticsTrigger | undefined {
        const state = this.lifecycle_by_uri.get(uri);
        if (!state) {
            return undefined;
        }
        if (version > state.document_version) {
            state.document_version = version;
        }
        return {
            lifecycle_epoch: state.lifecycle_epoch,
            document_version: version,
            force_epoch: state.force_epoch,
        };
    }

    is_current_trigger(
        uri: string,
        trigger: DiagnosticsTrigger | undefined
    ): boolean {
        return !!trigger && !!this.state_for_trigger(uri, trigger);
    }

    would_publish(
        uri: string,
        version: number,
        trigger: DiagnosticsTrigger
    ): boolean {
        const state = this.state_for_trigger(uri, trigger);
        if (!state || version !== trigger.document_version) {
            return false;
        }

        if (state.last_published_version === undefined ||
            version > state.last_published_version) {
            return true;
        }
        if (version < state.last_published_version) {
            return false;
        }
        return trigger.force_epoch >
            (state.last_published_force_epoch ?? -1);
    }

    try_consume_publish(
        uri: string,
        version: number,
        trigger: DiagnosticsTrigger
    ): boolean {
        if (!this.would_publish(uri, version, trigger)) {
            return false;
        }
        const state = this.lifecycle_by_uri.get(uri)!;
        state.last_published_version = version;
        state.last_published_force_epoch = trigger.force_epoch;
        return true;
    }

    /** Authorize one same-version publication without creating a lifecycle. */
    mark_force_republish(uri: string): boolean {
        const state = this.lifecycle_by_uri.get(uri);
        if (!state) {
            return false;
        }
        state.force_epoch++;
        return true;
    }

    retire_lifecycle(uri: string): void {
        this.lifecycle_by_uri.delete(uri);
    }

    retire_all_lifecycles(): void {
        this.lifecycle_by_uri.clear();
    }

    private trigger_from(
        state: DiagnosticsLifecycleState
    ): DiagnosticsTrigger {
        return {
            lifecycle_epoch: state.lifecycle_epoch,
            document_version: state.document_version,
            force_epoch: state.force_epoch,
        };
    }

    private state_for_trigger(
        uri: string,
        trigger: DiagnosticsTrigger
    ): DiagnosticsLifecycleState | undefined {
        const state = this.lifecycle_by_uri.get(uri);
        if (!state ||
            state.lifecycle_epoch !== trigger.lifecycle_epoch ||
            state.document_version !== trigger.document_version ||
            state.force_epoch !== trigger.force_epoch) {
            return undefined;
        }
        return state;
    }
}
