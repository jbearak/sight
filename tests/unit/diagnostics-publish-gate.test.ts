import { describe, expect, it } from 'bun:test';
import {
    DiagnosticsPublishGate,
} from '../../src/providers/diagnostics-publish-gate';

describe('DiagnosticsPublishGate', () => {
    const uri = 'file:///test.do';

    it('does not create publication state while scheduling', () => {
        const gate = new DiagnosticsPublishGate();

        expect(gate.trigger_for_validation(uri, 1)).toBeUndefined();
        expect(gate.mark_force_republish(uri)).toBe(false);
        expect(gate.trigger_for_validation(uri, 1)).toBeUndefined();
    });

    it('allows first publishes and strictly newer versions', () => {
        const gate = new DiagnosticsPublishGate();
        const trigger = gate.begin_lifecycle(uri, 1);

        expect(gate.would_publish(uri, 1, trigger)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, trigger)).toBe(true);

        const trigger_v2 = gate.trigger_for_validation(uri, 2)!;
        expect(gate.would_publish(uri, 2, trigger_v2)).toBe(true);
        expect(gate.try_consume_publish(uri, 2, trigger_v2)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, trigger)).toBe(false);
    });

    it('supersedes an older publish as soon as a newer version is scheduled', () => {
        const gate = new DiagnosticsPublishGate();
        const trigger_v1 = gate.begin_lifecycle(uri, 1);

        const trigger_v2 = gate.trigger_for_validation(uri, 2)!;

        expect(gate.is_current_trigger(uri, trigger_v1)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, trigger_v1)).toBe(false);
        expect(gate.try_consume_publish(uri, 2, trigger_v2)).toBe(true);
    });

    it('allows one same-version publish per force epoch', () => {
        const gate = new DiagnosticsPublishGate();
        const initial = gate.begin_lifecycle(uri, 1);

        expect(gate.try_consume_publish(uri, 1, initial)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, initial)).toBe(false);

        expect(gate.mark_force_republish(uri)).toBe(true);
        const forced = gate.trigger_for_validation(uri, 1)!;
        expect(forced.force_epoch).toBe(initial.force_epoch + 1);
        expect(gate.try_consume_publish(uri, 1, forced)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, forced)).toBe(false);
    });

    it('rejects work superseded by a newer force epoch', () => {
        const gate = new DiagnosticsPublishGate();
        gate.begin_lifecycle(uri, 1);
        gate.mark_force_republish(uri);
        const older = gate.trigger_for_validation(uri, 1)!;
        gate.mark_force_republish(uri);
        const newer = gate.trigger_for_validation(uri, 1)!;

        expect(gate.is_current_trigger(uri, older)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, older)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, newer)).toBe(true);
    });

    it('retires a lifecycle without reusing its identity', () => {
        const gate = new DiagnosticsPublishGate();
        const retired = gate.begin_lifecycle(uri, 1);
        expect(gate.try_consume_publish(uri, 1, retired)).toBe(true);

        gate.retire_lifecycle(uri);

        expect(gate.trigger_for_validation(uri, 1)).toBeUndefined();
        expect(gate.is_current_trigger(uri, retired)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, retired)).toBe(false);
        expect(gate.mark_force_republish(uri)).toBe(false);

        const reopened = gate.begin_lifecycle(uri, 1);
        expect(reopened.lifecycle_epoch).not.toBe(retired.lifecycle_epoch);
        expect(gate.try_consume_publish(uri, 1, retired)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, reopened)).toBe(true);
    });

    it('retires every lifecycle on shutdown', () => {
        const gate = new DiagnosticsPublishGate();
        const first = gate.begin_lifecycle('file:///first.do', 1);
        const second = gate.begin_lifecycle('file:///second.do', 1);

        gate.retire_all_lifecycles();

        expect(gate.trigger_for_validation('file:///first.do', 1))
            .toBeUndefined();
        expect(gate.trigger_for_validation('file:///second.do', 1))
            .toBeUndefined();
        expect(gate.try_consume_publish('file:///first.do', 1, first))
            .toBe(false);
        expect(gate.try_consume_publish('file:///second.do', 1, second))
            .toBe(false);
    });
});
