import { describe, expect, it } from 'bun:test';
import {
    DiagnosticsPublishGate,
} from '../../src/providers/diagnostics-publish-gate';

describe('DiagnosticsPublishGate', () => {
    const uri = 'file:///test.do';

    it('should allow first publishes and strictly newer versions', () => {
        const gate = new DiagnosticsPublishGate();
        const my_epoch_0 = gate.get_current_epoch(uri);

        expect(my_epoch_0).toBe(0);
        expect(gate.would_publish(uri, 1, my_epoch_0)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(true);

        expect(gate.would_publish(uri, 2, my_epoch_0)).toBe(true);
        expect(gate.try_consume_publish(uri, 2, my_epoch_0)).toBe(true);
    });

    it('should deny stale versions', () => {
        const gate = new DiagnosticsPublishGate();
        const my_epoch_0 = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 2, my_epoch_0)).toBe(true);
        expect(gate.would_publish(uri, 1, my_epoch_0)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(false);
    });

    it('should allow only the current unconsumed same-version epoch', () => {
        const gate = new DiagnosticsPublishGate();
        const my_epoch_0 = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(true);
        expect(gate.would_publish(uri, 1, my_epoch_0)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(false);

        gate.mark_force_republish(uri);
        const my_epoch_1 = gate.get_current_epoch(uri);

        expect(gate.would_publish(uri, 1, my_epoch_1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, my_epoch_1)).toBe(true);
        expect(gate.would_publish(uri, 1, my_epoch_1)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, my_epoch_1)).toBe(false);
    });

    it('should deny stale and non-current same-version epochs', () => {
        const gate = new DiagnosticsPublishGate();
        const my_epoch_0 = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(true);
        gate.mark_force_republish(uri);
        const my_epoch_1 = gate.get_current_epoch(uri);
        gate.mark_force_republish(uri);
        const my_epoch_2 = gate.get_current_epoch(uri);

        expect(gate.would_publish(uri, 1, my_epoch_0)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(false);
        expect(gate.would_publish(uri, 1, my_epoch_1)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, my_epoch_1)).toBe(false);
        expect(gate.would_publish(uri, 1, my_epoch_2 + 1)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, my_epoch_2 + 1)).toBe(false);

        expect(gate.would_publish(uri, 1, my_epoch_2)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, my_epoch_2)).toBe(true);
    });

    it('should not mutate state when checking would_publish', () => {
        const gate = new DiagnosticsPublishGate();
        const my_epoch_0 = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(true);
        gate.mark_force_republish(uri);
        const my_epoch_1 = gate.get_current_epoch(uri);

        expect(gate.would_publish(uri, 1, my_epoch_1)).toBe(true);
        expect(gate.would_publish(uri, 1, my_epoch_1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, my_epoch_1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, my_epoch_1)).toBe(false);
    });

    it('should bump force epochs and enable same-version consumes', () => {
        const gate = new DiagnosticsPublishGate();
        const my_epoch_0 = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(true);
        gate.mark_force_republish(uri);
        const my_epoch_1 = gate.get_current_epoch(uri);
        gate.mark_force_republish(uri);
        const my_epoch_2 = gate.get_current_epoch(uri);

        expect(my_epoch_1).toBe(my_epoch_0 + 1);
        expect(my_epoch_2).toBe(my_epoch_1 + 1);
        expect(gate.try_consume_publish(uri, 1, my_epoch_2)).toBe(true);
    });

    it('should retire the epoch when forgetting per-uri state', () => {
        const gate = new DiagnosticsPublishGate();
        const my_epoch_0 = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 3, my_epoch_0)).toBe(true);
        gate.mark_force_republish(uri);
        expect(gate.get_current_epoch(uri)).toBe(1);

        gate.forget(uri);

        expect(gate.is_current_epoch(uri, my_epoch_0)).toBe(false);
        expect(gate.would_publish(uri, 1, my_epoch_0)).toBe(false);
        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(false);

        const my_reopened_epoch = gate.get_current_epoch(uri);
        expect(my_reopened_epoch).not.toBe(my_epoch_0);
        expect(gate.would_publish(uri, 1, my_reopened_epoch)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, my_reopened_epoch)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, my_reopened_epoch)).toBe(false);
    });

    it('should deny older same-version work after newer work consumes', () => {
        const gate = new DiagnosticsPublishGate();
        const my_epoch_0 = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(true);
        gate.mark_force_republish(uri);
        const my_epoch_a = gate.get_current_epoch(uri);
        gate.mark_force_republish(uri);
        const my_epoch_b = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 1, my_epoch_b)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, my_epoch_a)).toBe(false);
    });

    it('should allow newer same-version work after older work consumes', () => {
        const gate = new DiagnosticsPublishGate();
        const my_epoch_0 = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 1, my_epoch_0)).toBe(true);
        gate.mark_force_republish(uri);
        const my_epoch_a = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 1, my_epoch_a)).toBe(true);

        gate.mark_force_republish(uri);
        const my_epoch_b = gate.get_current_epoch(uri);

        expect(gate.try_consume_publish(uri, 1, my_epoch_b)).toBe(true);
        expect(gate.try_consume_publish(uri, 1, my_epoch_a)).toBe(false);
    });
});
