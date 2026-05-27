/**
 * FilterPopover — fixed-position popover for adding or editing a single
 * filter entry.
 *
 * Behaviour by column kind (see filter-column-kind.ts):
 *  numeric          → numCompare | numBetween | numNotBetween + histogram brush
 *  labelledNumeric  → setIn / setNotIn (label checklist, stored & matched as
 *                     numeric codes) | numeric ops + histogram brush
 *  string           → contains / not contains / starts / ends / = / ≠ / regex
 *  date             → dateCompare | dateBetween | dateNotBetween
 *  universal        → isEmpty / isNotEmpty
 *
 * Invariant: one filter per column — on_apply replaces any existing entry
 * for this col_index in the caller (App).
 *
 * Ported from Raven's filter-popover; Stata adaptations: no factor/bool
 * kinds, set membership is a labelled-numeric code checklist (no shipped
 * dictionary / free-text path), and the date input type is derived from
 * the Stata %tc/%tC vs %td format rather than an Arrow type.
 */

import React, {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import type {
    FilterEntry,
    HistogramBin,
    VariableDescription,
} from '../types';
import { use_dismiss } from './use-dismiss';
import { FilterHistogram } from './filter-histogram';
import {
    col_kind,
    kind_options,
    labelled_choices,
} from './filter-column-kind';
import {
    build_predicate,
    default_form_state,
    predicate_to_kind_value,
    seed_from_entry,
    type DateBetweenState,
    type DateCompareState,
    type NumBetweenState,
    type NumCompareState,
    type SetState,
    type StrRegexState,
    type StrState,
} from './filter-popover-seed';

/** A small uid helper that tolerates webview runtimes without
 *  crypto.randomUUID. */
function new_id(): string {
    if (
        typeof crypto !== 'undefined'
        && typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-`
        + `${Math.random().toString(36).slice(2)}`;
}

const COMPARE_OPTIONS: [NumCompareState['op'], string][] = [
    ['=', '='], ['!=', '≠'], ['<', '<'],
    ['<=', '≤'], ['>', '>'], ['>=', '≥'],
];

interface FilterPopoverProps {
    column: VariableDescription;
    col_index: number;
    histogram?: HistogramBin[];
    /** Present when editing an existing entry; absent when adding. */
    initial?: FilterEntry;
    on_apply: (entry: FilterEntry) => void;
    on_cancel: () => void;
    anchor: { left_px: number; top_px: number };
}

export function FilterPopover({
    column,
    col_index,
    histogram,
    initial,
    on_apply,
    on_cancel,
    anchor,
}: FilterPopoverProps) {
    const my_kind = col_kind(column);
    const the_options = kind_options(my_kind);

    const [selected_kind, set_selected_kind] = useState<string>(() =>
        initial
            ? predicate_to_kind_value(initial.predicate)
            : the_options[0].value
    );

    // All sub-states stay alive so switching the kind-select and back
    // doesn't lose typed values; the matching one is seeded when editing.
    const seed = initial
        ? seed_from_entry(initial.predicate)
        : default_form_state();

    const [num_compare, set_num_compare] =
        useState<NumCompareState>(seed.num_compare);
    const [num_between, set_num_between] =
        useState<NumBetweenState>(seed.num_between);
    const [set_value, set_set_value] = useState<SetState>(seed.set);
    const [str, set_str] = useState<StrState>(seed.str);
    const [str_regex, set_str_regex] =
        useState<StrRegexState>(seed.str_regex);
    const [date_compare, set_date_compare] =
        useState<DateCompareState>(seed.date_compare);
    const [date_between, set_date_between] =
        useState<DateBetweenState>(seed.date_between);
    const [include_missing, set_include_missing] =
        useState(initial?.include_missing ?? false);
    const [label_search, set_label_search] = useState('');

    const popover_ref = useRef<HTMLDivElement>(null);
    const first_control_ref = useRef<HTMLSelectElement>(null);
    const [coords, set_coords] = useState({
        left: anchor.left_px,
        top: anchor.top_px,
    });

    use_dismiss(popover_ref, on_cancel);

    useLayoutEffect(() => {
        const my_el = popover_ref.current;
        if (!my_el) return;
        const MARGIN = 8;
        const my_rect = my_el.getBoundingClientRect();
        const my_max_left = Math.max(
            MARGIN,
            window.innerWidth - my_rect.width - MARGIN
        );
        const my_max_top = Math.max(
            MARGIN,
            window.innerHeight - my_rect.height - MARGIN
        );
        set_coords({
            left: Math.min(Math.max(MARGIN, anchor.left_px), my_max_left),
            top: Math.min(Math.max(MARGIN, anchor.top_px), my_max_top),
        });
    }, [anchor.left_px, anchor.top_px]);

    useEffect(() => {
        first_control_ref.current?.focus();
    }, []);

    const is_labelled_numeric = my_kind === 'labelledNumeric';
    const the_labelled_choices =
        is_labelled_numeric ? labelled_choices(column) : [];
    // Set membership only appears for labelled-numeric columns, and those
    // always resolve through the code checklist.
    const set_uses_checklist = is_labelled_numeric;

    const histo_lo = parseFloat(num_between.lo);
    const histo_hi = parseFloat(num_between.hi);
    const histo_valid = !isNaN(histo_lo) && !isNaN(histo_hi);
    const histo_d_min =
        histogram && histogram.length > 0 ? histogram[0].lo : 0;
    const histo_d_max =
        histogram && histogram.length > 0
            ? histogram[histogram.length - 1].hi
            : 0;

    const validate_regex = (pattern: string, case_sensitive: boolean) => {
        if (!pattern) {
            set_str_regex(s => ({ ...s, pattern, regex_error: null }));
            return;
        }
        try {
            new RegExp(pattern, case_sensitive ? '' : 'i');
            set_str_regex(s => ({ ...s, pattern, regex_error: null }));
        } catch (my_err) {
            set_str_regex(s => ({
                ...s,
                pattern,
                regex_error: (my_err as Error).message,
            }));
        }
    };

    const my_predicate = build_predicate(
        selected_kind,
        {
            num_compare,
            num_between,
            set: set_value,
            str,
            str_regex,
            date_compare,
            date_between,
            free_text: { text: '' },
        },
        { set_uses_checklist }
    );
    const can_apply = my_predicate !== null
        && !(selected_kind === 'strRegex' && str_regex.regex_error);

    const handle_apply = () => {
        if (!can_apply || !my_predicate) return;
        on_apply({
            id: initial?.id ?? new_id(),
            col_index,
            predicate: my_predicate,
            enabled: true,
            include_missing,
        });
    };

    const handle_key_down = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && can_apply) {
            e.preventDefault();
            handle_apply();
        }
        // Escape is handled by use_dismiss.
    };

    const show_missing_checkbox =
        selected_kind !== 'isEmpty' && selected_kind !== 'isNotEmpty';

    // %tc / %tC carry a time-of-day; %td / %d are date-only.
    const is_timestamp = /^%-?t[cC]/.test(column.format);
    const date_input_type = is_timestamp ? 'datetime-local' : 'date';

    return (
        <div
            ref={popover_ref}
            className="filter-popover"
            role="dialog"
            aria-label={`Filter on ${column.name}`}
            aria-modal="true"
            style={{ left: `${coords.left}px`, top: `${coords.top}px` }}
            onKeyDown={handle_key_down}
        >
            <div className="filter-popover-header">
                <span className="filter-popover-colname">
                    {column.name}
                </span>
                {column.label && (
                    <span className="filter-popover-subtitle">
                        {column.label}
                    </span>
                )}
            </div>

            <div className="filter-popover-body">
                <label className="filter-popover-field-label">
                    Condition
                </label>
                <select
                    ref={first_control_ref}
                    className="filter-popover-select"
                    value={selected_kind}
                    onChange={e => set_selected_kind(e.target.value)}
                >
                    {the_options.map(my_option => (
                        <option key={my_option.value} value={my_option.value}>
                            {my_option.label}
                        </option>
                    ))}
                </select>

                {selected_kind === 'numCompare' && (
                    <div className="filter-popover-row">
                        <select
                            className="filter-popover-op-select"
                            value={num_compare.op}
                            onChange={e =>
                                set_num_compare(s => ({
                                    ...s,
                                    op: e.target
                                        .value as NumCompareState['op'],
                                }))
                            }
                        >
                            {COMPARE_OPTIONS.map(([v, l]) => (
                                <option key={v} value={v}>{l}</option>
                            ))}
                        </select>
                        <input
                            type="number"
                            className="filter-popover-input"
                            placeholder="value"
                            value={num_compare.value}
                            onChange={e =>
                                set_num_compare(s => ({
                                    ...s,
                                    value: e.target.value,
                                }))
                            }
                        />
                    </div>
                )}

                {(selected_kind === 'numBetween'
                    || selected_kind === 'numNotBetween') && (
                    <>
                        <div className="filter-popover-row">
                            <input
                                type="number"
                                className="filter-popover-input"
                                placeholder="low"
                                value={num_between.lo}
                                onChange={e =>
                                    set_num_between(s => ({
                                        ...s,
                                        lo: e.target.value,
                                    }))
                                }
                            />
                            <span className="filter-popover-between-sep">
                                –
                            </span>
                            <input
                                type="number"
                                className="filter-popover-input"
                                placeholder="high"
                                value={num_between.hi}
                                onChange={e =>
                                    set_num_between(s => ({
                                        ...s,
                                        hi: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <label className="filter-popover-check-row">
                            <input
                                type="checkbox"
                                checked={num_between.inclusive}
                                onChange={e =>
                                    set_num_between(s => ({
                                        ...s,
                                        inclusive: e.target.checked,
                                    }))
                                }
                            />
                            Inclusive (≤, ≥)
                        </label>
                        {histogram && histogram.length > 0 && (
                            <FilterHistogram
                                bins={histogram}
                                lo={histo_valid ? histo_lo : histo_d_min}
                                hi={histo_valid ? histo_hi : histo_d_max}
                                on_change={(lo, hi) =>
                                    set_num_between(s => ({
                                        ...s,
                                        lo: String(lo),
                                        hi: String(hi),
                                    }))
                                }
                            />
                        )}
                    </>
                )}

                {(selected_kind === 'setIn'
                    || selected_kind === 'setNotIn') && (
                    <>
                        <input
                            type="text"
                            className="filter-popover-input filter-popover-search"
                            placeholder="Search labels…"
                            value={label_search}
                            onChange={e => set_label_search(e.target.value)}
                        />
                        <div className="filter-popover-checklist">
                            {the_labelled_choices
                                .filter(my_choice =>
                                    !label_search
                                    || my_choice.label
                                        .toLowerCase()
                                        .includes(
                                            label_search.toLowerCase()
                                        )
                                    || String(my_choice.code)
                                        .includes(label_search)
                                )
                                .map(my_choice => {
                                    const my_checked =
                                        set_value.selected.includes(
                                            my_choice.code
                                        );
                                    return (
                                        <label
                                            key={my_choice.code}
                                            className="filter-popover-check-row"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={my_checked}
                                                onChange={e =>
                                                    set_set_value(s => ({
                                                        selected:
                                                            e.target.checked
                                                                ? [
                                                                    ...s.selected,
                                                                    my_choice.code,
                                                                ]
                                                                : s.selected.filter(
                                                                    x =>
                                                                        x !==
                                                                        my_choice.code
                                                                ),
                                                    }))
                                                }
                                            />
                                            <span className="filter-popover-label-text">
                                                {my_choice.label}
                                            </span>
                                            <span className="filter-popover-code-dim">
                                                {my_choice.code}
                                            </span>
                                        </label>
                                    );
                                })}
                            {the_labelled_choices.length === 0 && (
                                <div className="filter-popover-hint">
                                    No labels available
                                </div>
                            )}
                        </div>
                    </>
                )}

                {(selected_kind === 'strContains'
                    || selected_kind === 'strNotContains'
                    || selected_kind === 'strStartsWith'
                    || selected_kind === 'strEndsWith'
                    || selected_kind === 'strCompareEq'
                    || selected_kind === 'strCompareNe') && (
                    <>
                        <input
                            type="text"
                            className="filter-popover-input"
                            placeholder="value"
                            value={str.value}
                            onChange={e =>
                                set_str(s => ({
                                    ...s,
                                    value: e.target.value,
                                }))
                            }
                        />
                        <label className="filter-popover-check-row">
                            <input
                                type="checkbox"
                                checked={str.case_sensitive}
                                onChange={e =>
                                    set_str(s => ({
                                        ...s,
                                        case_sensitive: e.target.checked,
                                    }))
                                }
                            />
                            Case sensitive
                        </label>
                    </>
                )}

                {selected_kind === 'strRegex' && (
                    <>
                        <input
                            type="text"
                            className={
                                str_regex.regex_error
                                    ? 'filter-popover-input '
                                        + 'filter-popover-input-error'
                                    : 'filter-popover-input'
                            }
                            placeholder="pattern — no delimiters needed"
                            value={str_regex.pattern}
                            onChange={e =>
                                validate_regex(
                                    e.target.value,
                                    str_regex.case_sensitive
                                )
                            }
                            aria-invalid={str_regex.regex_error !== null}
                        />
                        {str_regex.regex_error && (
                            <div
                                className="filter-popover-error"
                                role="alert"
                            >
                                {str_regex.regex_error}
                            </div>
                        )}
                        <label className="filter-popover-check-row">
                            <input
                                type="checkbox"
                                checked={str_regex.case_sensitive}
                                onChange={e => {
                                    const my_cs = e.target.checked;
                                    set_str_regex(s => {
                                        try {
                                            new RegExp(
                                                s.pattern,
                                                my_cs ? '' : 'i'
                                            );
                                            return {
                                                ...s,
                                                case_sensitive: my_cs,
                                                regex_error: null,
                                            };
                                        } catch (my_err) {
                                            return {
                                                ...s,
                                                case_sensitive: my_cs,
                                                regex_error:
                                                    (my_err as Error)
                                                        .message,
                                            };
                                        }
                                    });
                                }}
                            />
                            Case sensitive
                        </label>
                        <div className="filter-popover-hint">
                            Pattern is tested as{' '}
                            <code>
                                {str_regex.case_sensitive ? '/…/' : '/…/i'}
                            </code>
                        </div>
                    </>
                )}

                {selected_kind === 'dateCompare' && (
                    <div className="filter-popover-row">
                        <select
                            className="filter-popover-op-select"
                            value={date_compare.op}
                            onChange={e =>
                                set_date_compare(s => ({
                                    ...s,
                                    op: e.target
                                        .value as DateCompareState['op'],
                                }))
                            }
                        >
                            {COMPARE_OPTIONS.map(([v, l]) => (
                                <option key={v} value={v}>{l}</option>
                            ))}
                        </select>
                        <input
                            type={date_input_type}
                            className="filter-popover-input"
                            value={date_compare.value}
                            onChange={e =>
                                set_date_compare(s => ({
                                    ...s,
                                    value: e.target.value,
                                }))
                            }
                        />
                    </div>
                )}

                {(selected_kind === 'dateBetween'
                    || selected_kind === 'dateNotBetween') && (
                    <>
                        <div className="filter-popover-row">
                            <input
                                type={date_input_type}
                                className="filter-popover-input"
                                value={date_between.lo}
                                onChange={e =>
                                    set_date_between(s => ({
                                        ...s,
                                        lo: e.target.value,
                                    }))
                                }
                            />
                            <span className="filter-popover-between-sep">
                                –
                            </span>
                            <input
                                type={date_input_type}
                                className="filter-popover-input"
                                value={date_between.hi}
                                onChange={e =>
                                    set_date_between(s => ({
                                        ...s,
                                        hi: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <label className="filter-popover-check-row">
                            <input
                                type="checkbox"
                                checked={date_between.inclusive}
                                onChange={e =>
                                    set_date_between(s => ({
                                        ...s,
                                        inclusive: e.target.checked,
                                    }))
                                }
                            />
                            Inclusive
                        </label>
                    </>
                )}

                {show_missing_checkbox && (
                    <label className="filter-popover-check-row filter-popover-missing-row">
                        <input
                            type="checkbox"
                            checked={include_missing}
                            onChange={e =>
                                set_include_missing(e.target.checked)
                            }
                        />
                        Include missing
                    </label>
                )}
            </div>

            <div className="filter-popover-footer">
                <button
                    type="button"
                    className="filter-popover-btn filter-popover-btn-primary"
                    disabled={!can_apply}
                    onClick={handle_apply}
                >
                    Apply
                </button>
                <button
                    type="button"
                    className="filter-popover-btn"
                    onClick={on_cancel}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
