/**
 * Unit tests for the debounced parse pipeline.
 *
 * Covers:
 * - Parse happens inside debounce callback, not eagerly
 *   (Req 2.1, 2.3)
 * - Cross-file revalidation routes through debounce
 *   (Req 3.1)
 *
 * Since validate_text_document is a private function inside
 * server-factory.ts, we test the debounce manager's
 * schedule_validation behavior to verify that the callback
 * (which contains the parse + diagnostics + revalidation)
 * is deferred and not executed eagerly.
 */

import { describe, it, expect } from 'bun:test';
import { DocumentDebounceManager } from '../../src/utils/debounce-manager';

describe('Debounced Parse Pipeline', () => {
    /**
     * Req 2.1: document_store.update is NOT called eagerly
     * when schedule_validation is called — it only happens
     * inside the debounce callback.
     */
    describe('Parse deferred to callback (Req 2.1)', () => {
        it('callback is not executed synchronously on schedule', () => {
            const my_manager = new DocumentDebounceManager();
            my_manager.set_debounce_ms(50);

            let callback_executed = false;
            my_manager.schedule_validation(
                'file:///test.do',
                1,
                async () => {
                    callback_executed = true;
                }
            );

            // Immediately after scheduling, the callback
            // must NOT have run
            expect(callback_executed).toBe(false);

            // Cleanup
            my_manager.dispose();
        });

        it('callback executes only after debounce window', async () => {
            const my_manager = new DocumentDebounceManager();
            my_manager.set_debounce_ms(20);

            let callback_executed = false;
            my_manager.schedule_validation(
                'file:///test.do',
                1,
                async () => {
                    callback_executed = true;
                }
            );

            // Not executed immediately
            expect(callback_executed).toBe(false);

            // Wait for debounce + execution
            await my_manager.wait_for_debounce(
                'file:///test.do'
            );

            expect(callback_executed).toBe(true);

            my_manager.dispose();
        });

        it('multiple rapid calls coalesce into one callback', async () => {
            const my_manager = new DocumentDebounceManager();
            my_manager.set_debounce_ms(20);

            let callback_count = 0;
            const my_uri = 'file:///rapid.do';

            // Schedule 5 rapid validations for the same URI
            for (let i = 1; i <= 5; i++) {
                my_manager.schedule_validation(
                    my_uri,
                    i,
                    async () => {
                        callback_count++;
                    }
                );
            }

            // None should have executed yet
            expect(callback_count).toBe(0);

            // Wait for the debounce to complete
            await my_manager.wait_for_debounce(my_uri);

            // Only one callback should have executed
            // (the last one, coalesced)
            expect(callback_count).toBe(1);

            my_manager.dispose();
        });
    });

    /**
     * Req 2.3: Diagnostics are published inside the callback.
     *
     * We verify that the callback can perform async work
     * (simulating parse + diagnostic publication) and that
     * wait_for_debounce resolves only after all that work
     * completes.
     */
    describe('Diagnostics published inside callback (Req 2.3)', () => {
        it('async work in callback completes before wait resolves', async () => {
            const my_manager = new DocumentDebounceManager();
            my_manager.set_debounce_ms(10);

            const the_steps: string[] = [];

            my_manager.schedule_validation(
                'file:///diag.do',
                1,
                async () => {
                    the_steps.push('parse_start');
                    // Simulate async parse
                    await new Promise((resolve) =>
                        setTimeout(resolve, 10)
                    );
                    the_steps.push('parse_done');
                    // Simulate diagnostic publication
                    the_steps.push('diagnostics_published');
                }
            );

            // Nothing should have happened yet
            expect(the_steps.length).toBe(0);

            await my_manager.wait_for_debounce(
                'file:///diag.do'
            );

            // All steps should have completed
            expect(the_steps).toEqual([
                'parse_start',
                'parse_done',
                'diagnostics_published',
            ]);

            my_manager.dispose();
        });
    });

    /**
     * Req 3.1: Cross-file revalidation routes through
     * debounce.
     *
     * When a cross-file revalidation is triggered for a
     * callee document, it should be scheduled through the
     * debounce manager (not called directly). We verify
     * that scheduling a revalidation for a different URI
     * goes through the same debounce mechanism.
     */
    describe('Cross-file revalidation through debounce (Req 3.1)', () => {
        it('revalidation for callee URI is deferred via debounce', async () => {
            const my_manager = new DocumentDebounceManager();
            my_manager.set_debounce_ms(10);

            let parent_parsed = false;
            let callee_revalidated = false;

            const parent_uri = 'file:///parent.do';
            const callee_uri = 'file:///callee.do';

            // Simulate parent document validation that
            // triggers callee revalidation inside its
            // callback
            my_manager.schedule_validation(
                parent_uri,
                1,
                async () => {
                    parent_parsed = true;

                    // Inside the parent's callback,
                    // schedule callee revalidation
                    // through the same debounce manager
                    // (as server-factory.ts does via
                    // validate_text_document)
                    my_manager.schedule_validation(
                        callee_uri,
                        1,
                        async () => {
                            callee_revalidated = true;
                        }
                    );
                }
            );

            // Neither should have executed yet
            expect(parent_parsed).toBe(false);
            expect(callee_revalidated).toBe(false);

            // Wait for parent to complete
            await my_manager.wait_for_debounce(parent_uri);
            expect(parent_parsed).toBe(true);

            // Callee revalidation was scheduled inside
            // the parent callback, so it should be pending
            // now. Wait for it.
            await my_manager.wait_for_debounce(callee_uri);
            expect(callee_revalidated).toBe(true);

            my_manager.dispose();
        });

        it('multiple callee revalidations coalesce', async () => {
            const my_manager = new DocumentDebounceManager();
            my_manager.set_debounce_ms(10);

            let callee_callback_count = 0;
            const callee_uri = 'file:///shared_callee.do';

            // Simulate two parent documents both
            // triggering revalidation of the same callee
            my_manager.schedule_validation(
                callee_uri,
                1,
                async () => {
                    callee_callback_count++;
                }
            );

            // Second schedule for same URI replaces first
            my_manager.schedule_validation(
                callee_uri,
                2,
                async () => {
                    callee_callback_count++;
                }
            );

            await my_manager.wait_for_debounce(callee_uri);

            // Only one callback should have executed
            // (the second one replaced the first)
            expect(callee_callback_count).toBe(1);

            // Metrics should show a merged parse
            const metrics = my_manager.get_metrics();
            expect(metrics.merged_parses).toBeGreaterThanOrEqual(1);

            my_manager.dispose();
        });
    });

    /**
     * Verify that the debounce manager correctly tracks
     * pending state during the callback lifecycle.
     */
    describe('Pending state tracking', () => {
        it('is_pending returns true while debounce timer is active', () => {
            const my_manager = new DocumentDebounceManager();
            my_manager.set_debounce_ms(100);

            const my_uri = 'file:///pending.do';

            // Before scheduling, not pending
            expect(my_manager.is_pending(my_uri)).toBe(false);

            my_manager.schedule_validation(
                my_uri,
                1,
                async () => {}
            );

            // After scheduling, should be pending
            expect(my_manager.is_pending(my_uri)).toBe(true);

            my_manager.dispose();
        });

        it('is_pending returns false after callback completes', async () => {
            const my_manager = new DocumentDebounceManager();
            my_manager.set_debounce_ms(5);

            const my_uri = 'file:///done.do';

            my_manager.schedule_validation(
                my_uri,
                1,
                async () => {}
            );

            await my_manager.wait_for_debounce(my_uri);

            // After completion, no longer pending
            expect(my_manager.is_pending(my_uri)).toBe(false);

            my_manager.dispose();
        });
    });
});
