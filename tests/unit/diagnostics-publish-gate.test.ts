import { describe, expect, it } from 'bun:test';
import {
    DiagnosticsPublishGate,
} from '../../src/providers/diagnostics-publish-gate';

describe('DiagnosticsPublishGate', () => {
    const uri = 'file:///test.do';

    it('should advance monotonically for newer versions', () => {
        const gate = new DiagnosticsPublishGate();

        expect(gate.would_publish(uri, 1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        expect(gate.would_publish(uri, 2)).toBe(true);
        expect(gate.try_consume_publish(uri, 2)).toBe(true);
    });

    it('should deny stale versions', () => {
        const gate = new DiagnosticsPublishGate();

        expect(gate.try_consume_publish(uri, 2)).toBe(true);
        expect(gate.would_publish(uri, 1)).toBe(false);
        expect(gate.try_consume_publish(uri, 1)).toBe(false);
    });

    it('should deny same-version publishes when force budget is zero', () => {
        const gate = new DiagnosticsPublishGate();

        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        expect(gate.would_publish(uri, 1)).toBe(false);
        expect(gate.try_consume_publish(uri, 1)).toBe(false);
    });

    it('should count same-version force-republish budget exactly', () => {
        const gate = new DiagnosticsPublishGate();

        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        gate.mark_force_republish(uri);
        gate.mark_force_republish(uri);
        gate.mark_force_republish(uri);

        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1)).toBe(false);
    });

    it('should reset force budget when the version advances', () => {
        const gate = new DiagnosticsPublishGate();

        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        gate.mark_force_republish(uri);
        gate.mark_force_republish(uri);

        expect(gate.try_consume_publish(uri, 2)).toBe(true);
        expect(gate.would_publish(uri, 2)).toBe(false);
        expect(gate.try_consume_publish(uri, 2)).toBe(false);
    });

    it('should forget published state and force budget', () => {
        const gate = new DiagnosticsPublishGate();

        expect(gate.try_consume_publish(uri, 3)).toBe(true);
        gate.mark_force_republish(uri);
        gate.forget(uri);

        expect(gate.would_publish(uri, 1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1)).toBe(false);
    });

    it('should not consume budget when peeking with would_publish', () => {
        const gate = new DiagnosticsPublishGate();

        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        gate.mark_force_republish(uri);

        expect(gate.would_publish(uri, 1)).toBe(true);
        expect(gate.would_publish(uri, 1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1)).toBe(true);
        expect(gate.try_consume_publish(uri, 1)).toBe(false);
    });
});
